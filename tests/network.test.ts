import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Http, HttpError, Limiter, type FetchFn } from "../src/http.ts";
import { NetworkSource } from "../src/network.ts";
import { ConstellationError } from "../src/types.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers from a list of [url-substring, response] routes, recording each URL. */
function routed(routes: Array<[string, () => Response]>): { fetch: FetchFn; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const hit = routes.find(([needle]) => url.includes(needle));
      if (hit === undefined) throw new Error(`no route for ${url}`);
      return hit[1]();
    },
  };
}

const noSleep = async () => {};

test("Http retries 429 and 5xx with backoff, then succeeds", async () => {
  const answers = [json({}, 429), json({}, 503), json({ ok: true })];
  const delays: number[] = [];
  const http = new Http({
    fetch: async () => answers.shift() as Response,
    sleep: async (ms) => void delays.push(ms),
    baseDelayMs: 10,
  });
  assert.deepEqual(await http.getJson("https://example.com/x"), { ok: true });
  assert.deepEqual(delays, [10, 20]);
});

test("Http gives up after its attempts and does not retry a 400", async () => {
  let calls = 0;
  const failing = new Http({ fetch: async () => (calls++, json({}, 502)), sleep: noSleep, attempts: 3 });
  await assert.rejects(failing.getJson("https://example.com/x"), (e: unknown) => e instanceof HttpError && e.status === 502);
  assert.equal(calls, 3);
  calls = 0;
  const bad = new Http({ fetch: async () => (calls++, json({ error: "nope" }, 400)), sleep: noSleep });
  await assert.rejects(bad.getJson("https://example.com/x"), HttpError);
  assert.equal(calls, 1);
});

test("Limiter never runs more than its limit at once", async () => {
  const limiter = new Limiter(4);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
      }),
    ),
  );
  assert.equal(peak, 4);
});

test("blockers pages through Constellation by cursor", async () => {
  const pages = [
    { total: 3, linking_dids: ["did:plc:a", "did:plc:b"], cursor: "c1" },
    { total: 3, linking_dids: ["did:plc:c"], cursor: null },
  ];
  const r = routed([["getBacklinkDids", () => json(pages.shift())]]);
  const source = new NetworkSource(new Http({ fetch: r.fetch, sleep: noSleep }));
  assert.deepEqual(await source.blockers("did:plc:me"), ["did:plc:a", "did:plc:b", "did:plc:c"]);
  assert.equal(r.urls.length, 2);
  assert.match(r.urls[0] ?? "", /source=app\.bsky\.graph\.block%3Asubject/);
  assert.match(r.urls[1] ?? "", /cursor=c1/);
});

test("listsContaining keeps only list items written in the list owner's repo", async () => {
  const r = routed([
    [
      "getManyToMany",
      () =>
        json({
          items: [
            { linkRecord: { did: "did:plc:owner" }, otherSubject: "at://did:plc:owner/app.bsky.graph.list/l1" },
            { linkRecord: { did: "did:plc:other" }, otherSubject: "at://did:plc:owner/app.bsky.graph.list/l2" },
            { linkRecord: { did: "did:plc:owner" }, otherSubject: "at://did:plc:owner/app.bsky.graph.list/l1" },
          ],
          cursor: null,
        }),
    ],
  ]);
  const source = new NetworkSource(new Http({ fetch: r.fetch, sleep: noSleep }));
  assert.deepEqual(await source.listsContaining("did:plc:me"), ["at://did:plc:owner/app.bsky.graph.list/l1"]);
});

test("a Constellation failure becomes a ConstellationError", async () => {
  const r = routed([["constellation", () => json({}, 503)]]);
  const source = new NetworkSource(new Http({ fetch: r.fetch, sleep: noSleep, attempts: 2 }));
  await assert.rejects(source.blockers("did:plc:me"), ConstellationError);
  await assert.rejects(source.listSubscribers("at://did:plc:o/app.bsky.graph.list/x"), ConstellationError);
});

test("listView returns null for a deleted list and throws for other errors", async () => {
  const gone = routed([["getList", () => json({ error: "InvalidRequest", message: "List not found" }, 400)]]);
  assert.equal(await new NetworkSource(new Http({ fetch: gone.fetch, sleep: noSleep })).listView("at://x"), null);
  const broken = routed([["getList", () => json({ error: "InvalidRequest", message: "bad" }, 400)]]);
  await assert.rejects(new NetworkSource(new Http({ fetch: broken.fetch, sleep: noSleep })).listView("at://x"), HttpError);
});

test("profiles reads joinedViaStarterPack", async () => {
  const r = routed([
    [
      "getProfiles",
      () =>
        json({
          profiles: [
            {
              did: "did:plc:a",
              handle: "a.example.com",
              displayName: "",
              joinedViaStarterPack: {
                uri: "at://did:plc:o/app.bsky.graph.starterpack/p",
                record: { name: "Pack", list: "at://did:plc:o/app.bsky.graph.list/l" },
                creator: { did: "did:plc:o", handle: "o.example.com" },
              },
            },
          ],
        }),
    ],
  ]);
  const [p] = await new NetworkSource(new Http({ fetch: r.fetch, sleep: noSleep })).profiles(["did:plc:a"]);
  assert.deepEqual(p, {
    did: "did:plc:a",
    handle: "a.example.com",
    joinedViaStarterPack: {
      uri: "at://did:plc:o/app.bsky.graph.starterpack/p",
      name: "Pack",
      creator: { did: "did:plc:o", handle: "o.example.com" },
      listUri: "at://did:plc:o/app.bsky.graph.list/l",
    },
  });
});
