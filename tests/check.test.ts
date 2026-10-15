import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkAccount, diffSets, modListsOnly, starterPackFollows } from "../src/check.ts";
import { renderReport } from "../src/report.ts";
import type { AccountState, Profile } from "../src/types.ts";
import { FakeSource, WATCHED, actor, curateList, modList, world } from "./fixtures.ts";

async function run(source: FakeSource, previous: AccountState | null) {
  return checkAccount(source, WATCHED.handle, WATCHED.did, previous);
}

test("diffSets finds added and removed members", () => {
  assert.deepEqual(diffSets(["a", "b", "c"], ["b", "c", "d", "e"]), { added: ["d", "e"], removed: ["a"] });
  assert.deepEqual(diffSets([], []), { added: [], removed: [] });
  assert.deepEqual(diffSets(["a", "a"], ["a"]), { added: [], removed: [] });
});

test("modListsOnly keeps moderation lists and drops curate lists and missing lists", () => {
  const owner = actor(1);
  const mod = modList(1, owner);
  assert.deepEqual(modListsOnly([mod, curateList(2, owner), null]), [mod]);
});

test("the first run is a baseline: state is recorded and the report is empty", async () => {
  const owner = actor(90);
  const list = modList(1, owner);
  const source = new FakeSource(
    world({
      followers: [actor(1), actor(2)],
      blockers: [actor(3).did],
      lists: [list],
      memberOf: [list.uri],
      subscribers: { [list.uri]: [actor(4).did] },
    }),
  );
  const r = await run(source, null);
  assert.equal(renderReport([r.changes]), "");
  assert.deepEqual(r.counts.baseline, ["followers", "blocks", "mod lists"]);
  assert.deepEqual(Object.keys(r.state.followers ?? {}), [actor(1).did, actor(2).did]);
  assert.deepEqual(r.state.blockers, [actor(3).did]);
  assert.deepEqual(r.state.modLists?.[list.uri]?.subscribers, [actor(4).did]);
});

test("a second run with nothing changed prints nothing", async () => {
  const owner = actor(90);
  const list = modList(1, owner);
  const w = world({
    followers: [actor(1), actor(2)],
    blockers: [actor(3).did],
    lists: [list],
    memberOf: [list.uri],
    subscribers: { [list.uri]: [actor(4).did] },
  });
  const first = await run(new FakeSource(w), null);
  const second = await run(new FakeSource(w), first.state);
  assert.equal(renderReport([second.changes]), "");
  assert.deepEqual(second.counts.baseline, []);
  assert.deepEqual(second.state, first.state);
});

test("follows, unfollows, blocks and mod list changes are reported", async () => {
  const owner = actor(90);
  const [stays, gone, kept] = [modList(1, owner, "Stays"), modList(2, owner, "Gone"), modList(3, owner, "New")];
  const before = world({
    followers: [actor(1), actor(2)],
    blockers: [actor(3).did],
    lists: [stays, gone],
    memberOf: [stays.uri, gone.uri],
    subscribers: { [stays.uri]: [actor(4).did, actor(5).did] },
  });
  const first = await run(new FakeSource(before), null);
  const after = world({
    followers: [actor(2), actor(6)],
    profiles: [actor(1), actor(7), actor(8)],
    blockers: [actor(7).did],
    lists: [stays, kept],
    memberOf: [stays.uri, kept.uri],
    subscribers: { [stays.uri]: [actor(5).did, actor(8).did] },
  });
  const r = await run(new FakeSource(after), first.state);
  const c = r.changes;
  assert.deepEqual(c.newFollowers.map((a) => a.handle), [actor(6).handle]);
  assert.deepEqual(c.unfollows.map((a) => a.handle), [actor(1).handle]);
  assert.deepEqual(c.blockedBy.map((a) => a.handle), [actor(7).handle]);
  // actor(3) has no profile any more; the DID still identifies them.
  assert.deepEqual(c.unblockedBy.map((a) => a.handle), [actor(3).did]);
  assert.deepEqual(c.addedToModLists.map((l) => l.name), ["New"]);
  assert.deepEqual(c.removedFromModLists.map((l) => l.name), ["Gone"]);
  assert.equal(c.subscriberChanges.length, 1);
  assert.deepEqual(c.subscriberChanges[0]?.gained.map((a) => a.handle), [actor(8).handle]);
  assert.deepEqual(c.subscriberChanges[0]?.lost.map((a) => a.did), [actor(4).did]);

  const report = renderReport([c]);
  assert.match(report, /^@alice\.example\.com\n/);
  assert.match(report, /New followers \(1\)\n {4}@user6\.example\.com https:\/\/bsky\.app\/profile\/did:plc:fake/);
  assert.match(report, /Unfollowed \(1\)/);
  assert.match(report, /Blocked you \(1\)/);
  assert.match(report, /Added to a moderation list \(1\)\n {4}"New" by @user90\.example\.com/);
  assert.match(report, /New block subscribers to "Stays"/);
});

test("an unfollow by an account the AppView no longer returns keeps its last known handle", async () => {
  const first = await run(new FakeSource(world({ followers: [actor(1)] })), null);
  const r = await run(new FakeSource(world({ followers: [] })), first.state);
  assert.deepEqual(r.changes.unfollows, [{ did: actor(1).did, handle: actor(1).handle }]);
});

test("starter pack matching needs both a joinedVia pack and the watched account in it", async () => {
  const owner = actor(90);
  const withHim = `at://${owner.did}/app.bsky.graph.list/packA`;
  const without = `at://${owner.did}/app.bsky.graph.list/packB`;
  const pack = (listUri: string, name: string) => ({ uri: `${listUri}-pack`, name, creator: owner, listUri });
  const followers: Profile[] = [
    { ...actor(1), joinedViaStarterPack: pack(withHim, "Pack A") },
    { ...actor(2), joinedViaStarterPack: pack(without, "Pack B") },
    { ...actor(3) },
    { ...actor(4), joinedViaStarterPack: pack(withHim, "Pack A") },
  ];
  const source = new FakeSource(world({ packMembers: { [withHim]: [WATCHED.did], [without]: [actor(5).did] } }));
  const found = await starterPackFollows(source, WATCHED.did, followers);
  assert.deepEqual(
    found.map((f) => [f.follower.handle, f.packName, f.packOwner.handle]),
    [
      [actor(1).handle, "Pack A", owner.handle],
      [actor(4).handle, "Pack A", owner.handle],
    ],
  );
  // Each pack's list is read once, however many followers name it.
  assert.equal(source.calls.filter((c) => c.endsWith("packA")).length, 1);
});

test("starter pack follows show up in the report for new followers only", async () => {
  const owner = actor(90);
  const listUri = `at://${owner.did}/app.bsky.graph.list/packA`;
  const joined = { uri: "at://pack", name: "Pack A", creator: owner, listUri };
  const first = await run(new FakeSource(world({ followers: [actor(1)] })), null);
  const r = await run(
    new FakeSource(
      world({
        followers: [actor(1), actor(2)],
        profiles: [{ ...actor(2), joinedViaStarterPack: joined }],
        packMembers: { [listUri]: [WATCHED.did] },
      }),
    ),
    first.state,
  );
  assert.equal(r.changes.starterPackFollows.length, 1);
  assert.match(renderReport([r.changes]), /@user2\.example\.com https:\/\/bsky\.app\/profile\/\S+ joined via "Pack A" by @user90\.example\.com/);
});

test("Constellation being down keeps follower changes, warns, and keeps the old block state", async () => {
  const first = await run(new FakeSource(world({ followers: [actor(1)], blockers: [actor(3).did] })), null);
  const r = await run(new FakeSource(world({ followers: [actor(1), actor(2)], constellationDown: true })), first.state);
  assert.deepEqual(r.changes.newFollowers.map((a) => a.handle), [actor(2).handle]);
  assert.equal(r.changes.warnings.length, 2);
  assert.match(r.changes.warnings[0] ?? "", /^Blocks could not be checked: Constellation did not answer/);
  assert.match(r.changes.warnings[1] ?? "", /^Block lists could not be checked/);
  assert.deepEqual(r.state.blockers, [actor(3).did]);
  assert.equal(r.counts.blockers, null);
  const report = renderReport([r.changes]);
  assert.match(report, /Not checked \(2\)/);
});

test("Constellation down on the first run leaves those sections without a baseline", async () => {
  const r = await run(new FakeSource(world({ followers: [actor(1)], constellationDown: true })), null);
  assert.equal(r.state.blockers, null);
  assert.equal(r.state.modLists, null);
  assert.deepEqual(r.counts.baseline, ["followers"]);
  // The next good run records the baseline and reports nothing for blocks.
  const next = await run(new FakeSource(world({ followers: [actor(1)], blockers: [actor(3).did] })), r.state);
  assert.equal(renderReport([next.changes]), "");
  assert.deepEqual(next.counts.baseline, ["blocks", "mod lists"]);
});

test("an empty report for several accounts is the empty string", () => {
  const empty = {
    handle: "a.example.com",
    did: "did:plc:x",
    newFollowers: [],
    unfollows: [],
    starterPackFollows: [],
    blockedBy: [],
    unblockedBy: [],
    addedToModLists: [],
    removedFromModLists: [],
    subscriberChanges: [{ list: { uri: "at://x/app.bsky.graph.list/y", name: "L", owner: actor(1) }, gained: [], lost: [] }],
    warnings: [],
  };
  assert.equal(renderReport([empty, { ...empty, handle: "b.example.com" }]), "");
});
