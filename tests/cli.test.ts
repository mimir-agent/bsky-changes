import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type Io } from "../src/cli.ts";
import { FakeSource, WATCHED, actor, world, type World } from "./fixtures.ts";

function setup(w: World, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bsky-changes-test-"));
  const stateDir = join(dir, "state");
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ accounts: [WATCHED.handle], stateDir, ...extra }));
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    env: {},
    now: () => new Date("2026-01-02T03:04:05Z"),
    source: () => new FakeSource(w),
  };
  return { dir, stateDir, config, out, err, io, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("baseline run prints nothing and saves state; an unchanged second run prints nothing", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  assert.equal(await main(["--config", s.config], s.io), 0);
  assert.equal(s.out.join(""), "");
  assert.equal(readdirSync(s.stateDir).length, 1);
  assert.equal(await main(["--config", s.config], s.io), 0);
  assert.equal(s.out.join(""), "");
});

test("--dry-run saves no state", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  assert.equal(await main(["--config", s.config, "--dry-run", "--verbose"], s.io), 0);
  assert.equal(s.out.join(""), "");
  assert.deepEqual(readdirSync(s.dir), ["config.json"]);
  assert.match(s.err.join(""), /1 followers, 0 blockers, 0 mod lists, 0 starter packs; baseline recorded for followers, blocks, mod lists, starter packs/);
});

test("changes are printed to stdout", async (t) => {
  const w = world({ followers: [actor(1)] });
  const s = setup(w);
  t.after(s.cleanup);
  await main(["--config", s.config], s.io);
  w.followers = [actor(1), actor(2)];
  assert.equal(await main(["--config", s.config], s.io), 0);
  // Stdout is the plain-text version: no HTML, no URLs.
  const out = s.out.join("");
  assert.equal(out, "1 new follower across 1 account.\n\n@alice.example.com\n@user2.example.com followed you.\n");
});

test("--email without the environment fails before doing any work and names only the variables", async (t) => {
  const s = setup(world(), { email: { to: "someone@example.com" } });
  t.after(s.cleanup);
  s.io.env = { EMAIL_ADDRESS: "sender@example.com", EMAIL_PASSWORD: "hunter2-secret" };
  assert.equal(await main(["--config", s.config, "--email"], s.io), 2);
  const err = s.err.join("");
  assert.match(err, /EMAIL_SMTP_HOST, EMAIL_SMTP_PORT/);
  assert.doesNotMatch(err, /hunter2-secret/);
  assert.doesNotMatch(err, /sender@example\.com/);
});

test("an account that cannot be resolved exits 1 and the others still run", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  writeFileSync(s.config, JSON.stringify({ accounts: ["nobody.example.com", WATCHED.handle], stateDir: s.stateDir }));
  assert.equal(await main(["--config", s.config], s.io), 1);
  assert.match(s.err.join(""), /@nobody\.example\.com could not be checked/);
  assert.equal(readdirSync(s.stateDir).length, 1);
});

test("a state file from the previous version on disk loads, and --verbose prints counts only", async (t) => {
  const s = setup(world({ followers: [actor(1), actor(3)], statuses: { [actor(2).did]: "deactivated" } }));
  t.after(s.cleanup);
  mkdirSync(s.stateDir, { recursive: true });
  // Written byte for byte the way the previous version wrote it.
  const old = {
    version: 1,
    did: WATCHED.did,
    handle: WATCHED.handle,
    followers: { [actor(1).did]: actor(1).handle, [actor(2).did]: actor(2).handle },
    blockers: [],
    modLists: {},
    starterPacks: {},
  };
  writeFileSync(join(s.stateDir, `${WATCHED.did.replaceAll(":", "_")}.json`), `${JSON.stringify(old, null, 2)}\n`);
  assert.equal(await main(["--config", s.config, "--dry-run", "--verbose"], s.io), 0);
  assert.equal(
    s.out.join(""),
    "1 new follower and 1 follower no longer active across 1 account.\n\n@alice.example.com\n" +
      "@user3.example.com followed you.\n@user2.example.com no longer follows you: the account is deactivated.\n",
  );
  const err = s.err.join("");
  assert.match(err, /^@alice\.example\.com: 2 followers, 0 blockers, 0 mod lists, 0 starter packs\n$/);
  assert.doesNotMatch(err, /user\d/);
});
