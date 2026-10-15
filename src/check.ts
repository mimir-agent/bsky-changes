// One watched account: read the current graph, compare it with the saved
// state, and return what changed plus the state to save. A section with no
// saved baseline records one and reports nothing.
import {
  ConstellationError,
  MODLIST,
  type Actor,
  type AccountState,
  type ListView,
  type ModListState,
  type Profile,
  type Source,
} from "./types.ts";

export interface StarterPackFollow {
  follower: Actor;
  packName: string;
  packOwner: Actor;
}

export interface ListRef {
  uri: string;
  name: string;
  owner: Actor;
}

export interface SubscriberChange {
  list: ListRef;
  gained: Actor[];
  lost: Actor[];
}

export interface AccountChanges {
  handle: string;
  did: string;
  newFollowers: Actor[];
  unfollows: Actor[];
  starterPackFollows: StarterPackFollow[];
  blockedBy: Actor[];
  unblockedBy: Actor[];
  addedToModLists: ListRef[];
  removedFromModLists: ListRef[];
  subscriberChanges: SubscriberChange[];
  /** Sections that could not be checked this run, in plain words. */
  warnings: string[];
}

/** What a check found, for a one-line summary (counts only, no names). */
export interface Counts {
  followers: number;
  blockers: number | null;
  modLists: number | null;
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

export function hasChanges(c: AccountChanges): boolean {
  return (
    c.newFollowers.length > 0 ||
    c.unfollows.length > 0 ||
    c.starterPackFollows.length > 0 ||
    c.blockedBy.length > 0 ||
    c.unblockedBy.length > 0 ||
    c.addedToModLists.length > 0 ||
    c.removedFromModLists.length > 0 ||
    c.subscriberChanges.some((s) => s.gained.length > 0 || s.lost.length > 0) ||
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
      return { follower: plainActor(follower), packName: pack.name, packOwner: pack.creator };
    }),
  );
  return found.filter((x): x is StarterPackFollow => x !== null);
}

function plainActor(a: Actor): Actor {
  const out: Actor = { did: a.did, handle: a.handle };
  if (a.displayName !== undefined) out.displayName = a.displayName;
  return out;
}

/** Actors for DIDs, from fresh profiles when the AppView has them, else a known handle, else the DID alone. */
async function resolveActors(source: Source, dids: string[], known: Record<string, string> = {}): Promise<Actor[]> {
  if (dids.length === 0) return [];
  const byDid = new Map((await source.profiles(dids)).map((p) => [p.did, plainActor(p)]));
  return dids.map((did) => byDid.get(did) ?? { did, handle: known[did] ?? did });
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
    starterPackFollows: [],
    blockedBy: [],
    unblockedBy: [],
    addedToModLists: [],
    removedFromModLists: [],
    subscriberChanges: [],
    warnings: [],
  };
  const state: AccountState = {
    version: 1,
    did,
    handle,
    followers: previous?.followers ?? null,
    blockers: previous?.blockers ?? null,
    modLists: previous?.modLists ?? null,
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
    changes.unfollows = await resolveActors(source, removed, previous.followers);
    if (added.length > 0) {
      const profiles = await source.profiles(added);
      changes.starterPackFollows = await starterPackFollows(source, did, profiles);
    }
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

  let modListCount: number | null = null;
  try {
    const current = await currentModLists(source, did);
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

  return {
    changes,
    state,
    counts: { followers: followers.length, blockers: blockerCount, modLists: modListCount, baseline },
  };
}

/** Mod lists the account is on, with who subscribes to block each. */
async function currentModLists(source: Source, did: string): Promise<Record<string, ModListState>> {
  const uris = await source.listsContaining(did);
  const views = modListsOnly(await Promise.all(uris.map((uri) => source.listView(uri))));
  const entries = await Promise.all(
    views.map(async (v): Promise<[string, ModListState]> => [
      v.uri,
      { name: v.name, owner: v.owner, subscribers: await source.listSubscribers(v.uri) },
    ]),
  );
  return Object.fromEntries(entries);
}
