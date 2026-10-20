// One watched account: read the current graph, compare it with the saved
// state, and return what changed plus the state to save. A section with no
// saved baseline records one and reports nothing.
import { looksLikeBot } from "./bots.ts";
import {
  ConstellationError,
  MODLIST,
  type AccountStatus,
  type Actor,
  type AccountState,
  type ListView,
  type ModListState,
  type Profile,
  type Source,
  type StarterPackState,
} from "./types.ts";

export interface StarterPackFollow {
  follower: Actor;
  /** AT-URI of the starter pack record. */
  packUri: string;
  packName: string;
  packOwner: Actor;
}

export interface ListRef {
  uri: string;
  name: string;
  owner: Actor;
}

export interface StarterPackRef {
  uri: string;
  name: string;
  owner: Actor;
}

export interface SubscriberChange {
  list: ListRef;
  gained: Actor[];
  lost: Actor[];
}

/** A follower that is gone because the AppView no longer shows the account. */
export interface GoneFollower {
  actor: Actor;
  status: AccountStatus;
}

export interface AccountChanges {
  handle: string;
  did: string;
  newFollowers: Actor[];
  /** Former followers whose account is still active: they unfollowed. */
  unfollows: Actor[];
  /** Former followers the AppView no longer shows, with why as far as it says. */
  goneFollowers: GoneFollower[];
  /** DIDs among newFollowers and unfollows that look like bots (see bots.ts). */
  likelyBots: string[];
  starterPackFollows: StarterPackFollow[];
  blockedBy: Actor[];
  unblockedBy: Actor[];
  addedToModLists: ListRef[];
  removedFromModLists: ListRef[];
  subscriberChanges: SubscriberChange[];
  addedToStarterPacks: StarterPackRef[];
  removedFromStarterPacks: StarterPackRef[];
  /** Sections that could not be checked this run, in plain words. */
  warnings: string[];
}

/** What a check found, for a one-line summary (counts only, no names). */
export interface Counts {
  followers: number;
  blockers: number | null;
  modLists: number | null;
  starterPacks: number | null;
  baseline: string[];
}

export interface CheckResult {
  changes: AccountChanges;
  state: AccountState;
  counts: Counts;
}

export interface Diff {
  added: string[];
  removed: string[];
}

/** Members of `current` not in `previous`, and the reverse. Order follows the inputs. */
export function diffSets(previous: Iterable<string>, current: Iterable<string>): Diff {
  const before = new Set(previous);
  const after = new Set(current);
  return {
    added: [...after].filter((x) => !before.has(x)),
    removed: [...before].filter((x) => !after.has(x)),
  };
}

/** Keep only moderation lists; curate lists and reference lists do not block or mute. */
export function modListsOnly(views: Array<ListView | null>): ListView[] {
  return views.filter((v): v is ListView => v !== null && v.purpose === MODLIST);
}

/** Lists that are not moderation lists: the only kind a starter pack can be built on. */
export function nonModLists(views: Array<ListView | null>): ListView[] {
  return views.filter((v): v is ListView => v !== null && v.purpose !== MODLIST);
}

export function hasChanges(c: AccountChanges): boolean {
  return (
    c.newFollowers.length > 0 ||
    c.unfollows.length > 0 ||
    c.goneFollowers.length > 0 ||
    c.starterPackFollows.length > 0 ||
    c.blockedBy.length > 0 ||
    c.unblockedBy.length > 0 ||
    c.addedToModLists.length > 0 ||
    c.removedFromModLists.length > 0 ||
    c.subscriberChanges.some((s) => s.gained.length > 0 || s.lost.length > 0) ||
    c.addedToStarterPacks.length > 0 ||
    c.removedFromStarterPacks.length > 0 ||
    c.warnings.length > 0
  );
}

/**
 * New followers whose profile says they signed up through a starter pack
 * that has `watchedDid` in it. Each pack's list is fetched at most once.
 */
export async function starterPackFollows(
  source: Source,
  watchedDid: string,
  newFollowers: Profile[],
): Promise<StarterPackFollow[]> {
  const membership = new Map<string, Promise<boolean>>();
  const found = await Promise.all(
    newFollowers.map(async (follower): Promise<StarterPackFollow | null> => {
      const pack = follower.joinedViaStarterPack;
      if (pack === undefined) return null;
      let inPack = membership.get(pack.listUri);
      if (inPack === undefined) {
        inPack = source.listHasMember(pack.listUri, watchedDid);
        membership.set(pack.listUri, inPack);
      }
      if (!(await inPack)) return null;
      return { follower: plainActor(follower), packUri: pack.uri, packName: pack.name, packOwner: pack.creator };
    }),
  );
  return found.filter((x): x is StarterPackFollow => x !== null);
}

function plainActor(a: Actor): Actor {
  const out: Actor = { did: a.did, handle: a.handle };
  if (a.displayName !== undefined) out.displayName = a.displayName;
  return out;
}

/** Actors for DIDs, from fresh profiles when the AppView has them, else the DID alone. */
async function resolveActors(source: Source, dids: string[]): Promise<Actor[]> {
  if (dids.length === 0) return [];
  const byDid = new Map((await source.profiles(dids)).map((p) => [p.did, plainActor(p)]));
  return dids.map((did) => byDid.get(did) ?? { did, handle: did });
}

function constellationWarning(what: string, err: ConstellationError): string {
  return `${what} could not be checked: ${err.message}`;
}

function listRef(uri: string, s: ModListState): ListRef {
  return { uri, name: s.name, owner: s.owner };
}

export async function checkAccount(
  source: Source,
  handle: string,
  did: string,
  previous: AccountState | null,
): Promise<CheckResult> {
  const changes: AccountChanges = {
    handle,
    did,
    newFollowers: [],
    unfollows: [],
    goneFollowers: [],
    likelyBots: [],
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
  const state: AccountState = {
    version: 1,
    did,
    handle,
    followers: previous?.followers ?? null,
    blockers: previous?.blockers ?? null,
    modLists: previous?.modLists ?? null,
    starterPacks: previous?.starterPacks ?? null,
  };
  const baseline: string[] = [];

  // Followers come from the AppView. If it fails the whole account fails:
  // there is nothing useful to say without it.
  const followers = await source.followers(did);
  const followerMap: Record<string, string> = {};
  for (const f of followers) followerMap[f.did] = f.handle;
  if (previous?.followers == null) {
    baseline.push("followers");
  } else {
    const { added, removed } = diffSets(Object.keys(previous.followers), Object.keys(followerMap));
    const fresh = new Map(followers.map((f) => [f.did, f]));
    changes.newFollowers = added.map((d) => plainActor(fresh.get(d) as Actor));
    const joined = added.length > 0 ? await source.profiles(added) : [];
    if (joined.length > 0) changes.starterPackFollows = await starterPackFollows(source, did, joined);
    // A former follower the AppView still has a profile for unfollowed. One
    // it leaves out is no longer active; ask it why, one account at a time.
    const left = removed.length > 0 ? await source.profiles(removed) : [];
    const stillActive = new Map(left.map((p) => [p.did, p]));
    const known = previous.followers;
    for (const d of removed) {
      const p = stillActive.get(d);
      if (p !== undefined) changes.unfollows.push(plainActor(p));
    }
    changes.goneFollowers = await Promise.all(
      removed
        .filter((d) => !stillActive.has(d))
        .map(async (d): Promise<GoneFollower> => ({
          actor: { did: d, handle: known[d] ?? d },
          status: await source.accountStatus(d),
        })),
    );
    changes.likelyBots = [...joined, ...left].filter(looksLikeBot).map((p) => p.did);
  }
  state.followers = followerMap;

  let blockerCount: number | null = null;
  try {
    const blockers = await source.blockers(did);
    blockerCount = blockers.length;
    if (previous?.blockers == null) {
      baseline.push("blocks");
    } else {
      const { added, removed } = diffSets(previous.blockers, blockers);
      changes.blockedBy = await resolveActors(source, added);
      changes.unblockedBy = await resolveActors(source, removed);
    }
    state.blockers = blockers;
  } catch (err) {
    if (!(err instanceof ConstellationError)) throw err;
    changes.warnings.push(constellationWarning("Blocks", err));
  }

  // Both list sections start from the same list items, so read them once. If
  // Constellation cannot say which lists the account is on, neither section
  // can be checked.
  let lists: ListView[] | null = null;
  try {
    lists = await listsWith(source, did);
  } catch (err) {
    if (!(err instanceof ConstellationError)) throw err;
    changes.warnings.push(constellationWarning("Block lists", err));
    changes.warnings.push(constellationWarning("Starter packs", err));
  }

  let modListCount: number | null = null;
  if (lists !== null) {
    try {
      const current = await currentModLists(source, modListsOnly(lists));
      modListCount = Object.keys(current).length;
      if (previous?.modLists == null) {
        baseline.push("mod lists");
      } else {
        const before = previous.modLists;
        const { added, removed } = diffSets(Object.keys(before), Object.keys(current));
        changes.addedToModLists = added.map((uri) => listRef(uri, current[uri] as ModListState));
        changes.removedFromModLists = removed.map((uri) => listRef(uri, before[uri] as ModListState));
        for (const [uri, now] of Object.entries(current)) {
          const then = before[uri];
          if (then === undefined) continue;
          const d = diffSets(then.subscribers, now.subscribers);
          if (d.added.length === 0 && d.removed.length === 0) continue;
          changes.subscriberChanges.push({
            list: listRef(uri, now),
            gained: await resolveActors(source, d.added),
            lost: await resolveActors(source, d.removed),
          });
        }
      }
      state.modLists = current;
    } catch (err) {
      if (!(err instanceof ConstellationError)) throw err;
      changes.warnings.push(constellationWarning("Block lists", err));
    }
  }

  let starterPackCount: number | null = null;
  if (lists !== null) {
    try {
      const current = await currentStarterPacks(source, nonModLists(lists));
      starterPackCount = Object.keys(current).length;
      if (previous?.starterPacks == null) {
        baseline.push("starter packs");
      } else {
        const before = previous.starterPacks;
        const { added, removed } = diffSets(Object.keys(before), Object.keys(current));
        changes.addedToStarterPacks = added.map((uri) => packRef(uri, current[uri] as StarterPackState));
        changes.removedFromStarterPacks = removed.map((uri) => packRef(uri, before[uri] as StarterPackState));
      }
      state.starterPacks = current;
    } catch (err) {
      if (!(err instanceof ConstellationError)) throw err;
      changes.warnings.push(constellationWarning("Starter packs", err));
    }
  }

  return {
    changes,
    state,
    counts: {
      followers: followers.length,
      blockers: blockerCount,
      modLists: modListCount,
      starterPacks: starterPackCount,
      baseline,
    },
  };
}

/** Every list the account is on that the AppView still knows, of any purpose. */
async function listsWith(source: Source, did: string): Promise<ListView[]> {
  const uris = await source.listsContaining(did);
  const views = await Promise.all(uris.map((uri) => source.listView(uri)));
  return views.filter((v): v is ListView => v !== null);
}

/**
 * Starter packs the account is in: those built on one of `lists`. Each list
 * is checked for packs that use it; a list no pack uses adds nothing.
 */
async function currentStarterPacks(source: Source, lists: ListView[]): Promise<Record<string, StarterPackState>> {
  const packUris = (await Promise.all(lists.map((l) => source.starterPacksUsing(l.uri)))).flat();
  const views = await Promise.all([...new Set(packUris)].map((uri) => source.starterPackView(uri)));
  const entries = views
    .filter((v) => v !== null)
    .map((v): [string, StarterPackState] => [v.uri, { name: v.name, owner: v.owner }]);
  return Object.fromEntries(entries);
}

function packRef(uri: string, s: StarterPackState): StarterPackRef {
  return { uri, name: s.name, owner: s.owner };
}

/** Mod lists the account is on, with who subscribes to block each. */
async function currentModLists(source: Source, views: ListView[]): Promise<Record<string, ModListState>> {
  const entries = await Promise.all(
    views.map(async (v): Promise<[string, ModListState]> => [
      v.uri,
      { name: v.name, owner: v.owner, subscribers: await source.listSubscribers(v.uri) },
    ]),
  );
  return Object.fromEntries(entries);
}
