// An in-memory Source. Every DID and handle here is made up.
import { ConstellationError, MODLIST, type Actor, type ListView, type Profile, type Source } from "../src/types.ts";

export const WATCHED: Actor = { did: "did:plc:watched000000000000000000", handle: "alice.example.com" };

export function actor(n: number): Actor {
  return { did: `did:plc:fake${String(n).padStart(20, "0")}`, handle: `user${n}.example.com` };
}

export function modList(n: number, owner: Actor, name = `Mod list ${n}`): ListView {
  return { uri: `at://${owner.did}/app.bsky.graph.list/mod${n}`, name, purpose: MODLIST, owner };
}

export function curateList(n: number, owner: Actor): ListView {
  return {
    uri: `at://${owner.did}/app.bsky.graph.list/cur${n}`,
    name: `Curate list ${n}`,
    purpose: "app.bsky.graph.defs#curatelist",
    owner,
  };
}

export interface World {
  followers: Actor[];
  profiles: Profile[];
  blockers: string[];
  lists: ListView[];
  /** List URIs the watched account is on. */
  memberOf: string[];
  subscribers: Record<string, string[]>;
  /** Members of starter-pack lists, keyed by list URI. */
  packMembers: Record<string, string[]>;
  constellationDown: boolean;
}

export function world(partial: Partial<World> = {}): World {
  return {
    followers: [],
    profiles: [],
    blockers: [],
    lists: [],
    memberOf: [],
    subscribers: {},
    packMembers: {},
    constellationDown: false,
    ...partial,
  };
}

export class FakeSource implements Source {
  w: World;
  calls: string[] = [];
  constructor(w: World) {
    this.w = w;
  }
  private constellation(): void {
    if (this.w.constellationDown) throw new ConstellationError(new Error("HTTP 503 from constellation.example"));
  }
  async resolveHandle(handle: string): Promise<string> {
    if (handle !== WATCHED.handle) throw new Error(`unknown handle ${handle}`);
    return WATCHED.did;
  }
  async followers(): Promise<Actor[]> {
    return this.w.followers;
  }
  async profiles(dids: string[]): Promise<Profile[]> {
    // Later entries win, so a fixture profile overrides the follower entry.
    const known = new Map<string, Profile>([...this.w.followers, ...this.w.profiles].map((p) => [p.did, p]));
    return dids.flatMap((d) => {
      const p = known.get(d);
      return p === undefined ? [] : [p];
    });
  }
  async listView(uri: string): Promise<ListView | null> {
    return this.w.lists.find((l) => l.uri === uri) ?? null;
  }
  async listHasMember(listUri: string, did: string): Promise<boolean> {
    this.calls.push(`listHasMember ${listUri}`);
    return (this.w.packMembers[listUri] ?? []).includes(did);
  }
  async blockers(): Promise<string[]> {
    this.constellation();
    return this.w.blockers;
  }
  async listsContaining(): Promise<string[]> {
    this.constellation();
    return this.w.memberOf;
  }
  async listSubscribers(listUri: string): Promise<string[]> {
    this.constellation();
    return this.w.subscribers[listUri] ?? [];
  }
}
