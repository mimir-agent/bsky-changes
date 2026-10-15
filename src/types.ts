/** An account as the report shows it. */
export interface Actor {
  did: string;
  handle: string;
  displayName?: string;
}

/** The starter pack a profile says the account signed up through. */
export interface JoinedVia {
  uri: string;
  name: string;
  creator: Actor;
  /** AT-URI of the list holding the pack's members. */
  listUri: string;
}

export interface Profile extends Actor {
  joinedViaStarterPack?: JoinedVia;
}

export interface ListView {
  uri: string;
  name: string;
  purpose: string;
  owner: Actor;
}

/** A starter pack as the AppView shows it. The owner is the account whose repo holds the record. */
export interface StarterPackView {
  uri: string;
  name: string;
  owner: Actor;
}

export const MODLIST = "app.bsky.graph.defs#modlist";

/**
 * Everything the tool reads from the network. Methods that hit Constellation
 * throw ConstellationError when it cannot answer, so the caller can report
 * the other sections and say which ones could not be checked.
 */
export interface Source {
  resolveHandle(handle: string): Promise<string>;
  followers(did: string): Promise<Actor[]>;
  /** Profiles for the DIDs the AppView still knows. Missing ones are left out. */
  profiles(dids: string[]): Promise<Profile[]>;
  /** null when the AppView says the list does not exist (deleted or taken down). */
  listView(uri: string): Promise<ListView | null>;
  listHasMember(listUri: string, did: string): Promise<boolean>;
  /** DIDs with an app.bsky.graph.block record whose subject is `did`. */
  blockers(did: string): Promise<string[]>;
  /** AT-URIs of lists with a list item whose subject is `did`, written by the list owner. */
  listsContaining(did: string): Promise<string[]>;
  /** DIDs with an app.bsky.graph.listblock record whose subject is `listUri`. */
  listSubscribers(listUri: string): Promise<string[]>;
  /** AT-URIs of starter packs whose `list` field is `listUri`, written in the list owner's repo. */
  starterPacksUsing(listUri: string): Promise<string[]>;
  /** null when the AppView says the starter pack does not exist (deleted or taken down). */
  starterPackView(uri: string): Promise<StarterPackView | null>;
}

export class ConstellationError extends Error {
  constructor(cause: unknown) {
    super(`Constellation did not answer: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

export interface ModListState {
  name: string;
  owner: Actor;
  subscribers: string[];
}

export interface StarterPackState {
  name: string;
  owner: Actor;
}

/**
 * Saved per watched account, keyed by DID. A null section has no baseline
 * yet: the next successful check records one and reports nothing for it.
 */
export interface AccountState {
  version: 1;
  did: string;
  handle: string;
  /** DID to last known handle, so an unfollow by a deleted account still has a name. */
  followers: Record<string, string> | null;
  blockers: string[] | null;
  /** Mod lists the account is on, keyed by list AT-URI. */
  modLists: Record<string, ModListState> | null;
  /**
   * Starter packs the account is in, keyed by starter pack AT-URI. Absent from
   * state files written before starter packs were tracked, which reads as no
   * baseline yet.
   */
  starterPacks?: Record<string, StarterPackState> | null;
}
