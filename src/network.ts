// The live Source: the public Bluesky AppView for followers, profiles and
// lists, and the Constellation backlink index for blocks, list items and list
// subscriptions (the AppView does not expose who blocks whom).
import { Http, HttpError } from "./http.ts";
import { ConstellationError, type Actor, type ListView, type Profile, type Source } from "./types.ts";

export const APPVIEW = "https://public.api.bsky.app";
export const CONSTELLATION = "https://constellation.microcosm.blue";

const PAGE = 100;
const PROFILES_PER_CALL = 25;

type Json = Record<string, unknown>;

function obj(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`unexpected response shape: ${what} is not an object`);
  }
  return value as Json;
}

function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`unexpected response shape: ${what} is not an array`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`unexpected response shape: ${what} is not a string`);
  return value;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A cursor field: a string to continue, null or absent when done. */
function cursorOf(body: Json): string | undefined {
  return optStr(body.cursor);
}

function actorOf(value: unknown, what: string): Actor {
  const o = obj(value, what);
  const actor: Actor = { did: str(o.did, `${what}.did`), handle: str(o.handle, `${what}.handle`) };
  const displayName = optStr(o.displayName);
  if (displayName !== undefined) actor.displayName = displayName;
  return actor;
}

function profileOf(value: unknown): Profile {
  const profile: Profile = actorOf(value, "profile");
  const joined = obj(value, "profile").joinedViaStarterPack;
  if (joined !== undefined && joined !== null) {
    const pack = obj(joined, "joinedViaStarterPack");
    const record = obj(pack.record, "joinedViaStarterPack.record");
    profile.joinedViaStarterPack = {
      uri: str(pack.uri, "joinedViaStarterPack.uri"),
      name: str(record.name, "joinedViaStarterPack.record.name"),
      creator: actorOf(pack.creator, "joinedViaStarterPack.creator"),
      listUri: str(record.list, "joinedViaStarterPack.record.list"),
    };
  }
  return profile;
}

/** The repo DID of an AT-URI like at://did:plc:x/app.bsky.graph.list/rkey. */
export function atUriRepo(uri: string): string | undefined {
  return /^at:\/\/(did:[^/]+)\//.exec(uri)?.[1];
}

export class NetworkSource implements Source {
  private readonly http: Http;
  constructor(http: Http) {
    this.http = http;
  }

  private xrpc(method: string, params: Record<string, string | string[]>): string {
    const url = new URL(`/xrpc/${method}`, APPVIEW);
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    return url.toString();
  }

  private async constellation(path: string, params: Record<string, string>): Promise<Json> {
    const url = new URL(path, CONSTELLATION);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    try {
      return obj(await this.http.getJson(url.toString()), "constellation response");
    } catch (err) {
      throw new ConstellationError(err);
    }
  }

  /** Every DID with a `source` link (collection:path) to `subject`. */
  private async backlinkDids(subject: string, source: string): Promise<string[]> {
    const dids: string[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string> = { subject, source, limit: String(PAGE) };
      if (cursor !== undefined) params.cursor = cursor;
      const body = await this.constellation("/xrpc/blue.microcosm.links.getBacklinkDids", params);
      for (const did of arr(body.linking_dids, "linking_dids")) dids.push(str(did, "linking_dids[]"));
      cursor = cursorOf(body);
    } while (cursor !== undefined);
    return [...new Set(dids)];
  }

  async resolveHandle(handle: string): Promise<string> {
    const body = obj(
      await this.http.getJson(this.xrpc("com.atproto.identity.resolveHandle", { handle })),
      "resolveHandle",
    );
    return str(body.did, "resolveHandle.did");
  }

  async followers(did: string): Promise<Actor[]> {
    const out: Actor[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string> = { actor: did, limit: String(PAGE) };
      if (cursor !== undefined) params.cursor = cursor;
      const body = obj(await this.http.getJson(this.xrpc("app.bsky.graph.getFollowers", params)), "getFollowers");
      for (const f of arr(body.followers, "followers")) out.push(actorOf(f, "follower"));
      cursor = cursorOf(body);
    } while (cursor !== undefined);
    return out;
  }

  async profiles(dids: string[]): Promise<Profile[]> {
    const batches: string[][] = [];
    for (let i = 0; i < dids.length; i += PROFILES_PER_CALL) batches.push(dids.slice(i, i + PROFILES_PER_CALL));
    const results = await Promise.all(
      batches.map(async (actors) => {
        const body = obj(await this.http.getJson(this.xrpc("app.bsky.actor.getProfiles", { actors })), "getProfiles");
        return arr(body.profiles, "profiles").map(profileOf);
      }),
    );
    return results.flat();
  }

  async listView(uri: string): Promise<ListView | null> {
    let body: Json;
    try {
      body = obj(await this.http.getJson(this.xrpc("app.bsky.graph.getList", { list: uri, limit: "1" })), "getList");
    } catch (err) {
      // The AppView answers 400 "List not found" for a deleted or taken-down list.
      if (err instanceof HttpError && err.status === 400 && err.body.includes("List not found")) {
        return null;
      }
      throw err;
    }
    const list = obj(body.list, "getList.list");
    return {
      uri: str(list.uri, "list.uri"),
      name: str(list.name, "list.name"),
      purpose: str(list.purpose, "list.purpose"),
      owner: actorOf(list.creator, "list.creator"),
    };
  }

  async listHasMember(listUri: string, did: string): Promise<boolean> {
    return (await this.listMembers(listUri)).includes(did);
  }

  private async listMembers(listUri: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string> = { list: listUri, limit: String(PAGE) };
      if (cursor !== undefined) params.cursor = cursor;
      const body = obj(await this.http.getJson(this.xrpc("app.bsky.graph.getList", params)), "getList");
      for (const item of arr(body.items, "items")) {
        out.push(actorOf(obj(item, "item").subject, "item.subject").did);
      }
      cursor = cursorOf(body);
    } while (cursor !== undefined);
    return out;
  }

  blockers(did: string): Promise<string[]> {
    return this.backlinkDids(did, "app.bsky.graph.block:subject");
  }

  async listsContaining(did: string): Promise<string[]> {
    const lists = new Set<string>();
    let cursor: string | undefined;
    do {
      const params: Record<string, string> = {
        subject: did,
        source: "app.bsky.graph.listitem:subject",
        pathToOther: "list",
        limit: String(PAGE),
      };
      if (cursor !== undefined) params.cursor = cursor;
      const body = await this.constellation("/xrpc/blue.microcosm.links.getManyToMany", params);
      for (const raw of arr(body.items, "items")) {
        const item = obj(raw, "item");
        const author = str(obj(item.linkRecord, "linkRecord").did, "linkRecord.did");
        const list = str(item.otherSubject, "otherSubject");
        // A list item only counts when it lives in the list owner's repo;
        // anyone can write a record that points at someone else's list.
        if (atUriRepo(list) === author && list.includes("/app.bsky.graph.list/")) lists.add(list);
      }
      cursor = cursorOf(body);
    } while (cursor !== undefined);
    return [...lists];
  }

  listSubscribers(listUri: string): Promise<string[]> {
    return this.backlinkDids(listUri, "app.bsky.graph.listblock:subject");
  }
}
