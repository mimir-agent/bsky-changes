// One report that covers every change kind. All names, handles and DIDs are made up.
import type { AccountChanges } from "../src/check.ts";
import type { Actor } from "../src/types.ts";

export function person(n: number, displayName?: string): Actor {
  const a: Actor = { did: `did:plc:fake${String(n).padStart(20, "0")}`, handle: `user${n}.example.com` };
  if (displayName !== undefined) a.displayName = displayName;
  return a;
}

export function noChanges(handle: string, did: string): AccountChanges {
  return {
    handle,
    did,
    newFollowers: [],
    unfollows: [],
    starterPackFollows: [],
    blockedBy: [],
    unblockedBy: [],
    addedToModLists: [],
    removedFromModLists: [],
    subscriberChanges: [],
    addedToStarterPacks: [],
    removedFromStarterPacks: [],
    warnings: [],
  };
}

const owner = person(90, "Dana Owner");
const packOwner = person(91, "Erin Packs");

export function everyKind(): AccountChanges[] {
  const alice: AccountChanges = {
    ...noChanges("alice.example.com", "did:plc:alice00000000000000000"),
    newFollowers: [person(1, "Bob Builder"), person(2)],
    unfollows: [person(3, "Carol")],
    starterPackFollows: [
      {
        follower: person(2),
        packUri: `at://${packOwner.did}/app.bsky.graph.starterpack/sp1`,
        packName: "Cider makers",
        packOwner,
      },
    ],
    blockedBy: [person(4, "Skalman")],
    unblockedBy: [person(5)],
    addedToModLists: [
      { uri: `at://${owner.did}/app.bsky.graph.list/mod1`, name: "Spam accounts", owner },
    ],
    removedFromModLists: [
      { uri: `at://${owner.did}/app.bsky.graph.list/mod2`, name: "Reply guys", owner },
    ],
    subscriberChanges: [
      {
        list: { uri: `at://${owner.did}/app.bsky.graph.list/mod1`, name: "Spam accounts", owner },
        gained: [person(6, "Frank"), person(7, "Grace"), person(8)],
        lost: [person(9, "Heidi")],
      },
    ],
    addedToStarterPacks: [
      { uri: `at://${packOwner.did}/app.bsky.graph.starterpack/sp2`, name: "If you need a starter pack, use this.", owner: packOwner },
    ],
    removedFromStarterPacks: [
      { uri: `at://${owner.did}/app.bsky.graph.starterpack/sp3`, name: "Old friends", owner },
    ],
  };
  const many = Array.from({ length: 9 }, (_, i) => person(100 + i, i % 2 === 0 ? `Follower ${i + 1}` : undefined));
  const alt: AccountChanges = {
    ...noChanges("alice-alt.example.com", "did:plc:alt0000000000000000000"),
    newFollowers: many,
    warnings: ["Blocks could not be checked: Constellation did not answer: HTTP 503"],
  };
  return [alice, noChanges("quiet.example.com", "did:plc:quiet00000000000000000"), alt];
}
