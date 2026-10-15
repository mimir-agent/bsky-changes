// The report, in short sentences. One structure is built per run and then
// written out twice: as plain text (names and handles, no URLs) and as HTML
// (every account, list and starter pack is a link on its name). Accounts with
// nothing to say are left out; when no account has anything, there is no report.
import { hasChanges, type AccountChanges, type ListRef, type StarterPackRef } from "./check.ts";
import type { Actor } from "./types.ts";

/** Groups longer than this are listed one per line instead of joined into a sentence. */
export const MAX_JOINED = 8;

/**
 * A piece of a sentence. An actor is shown by display name, falling back to
 * @handle; `full` adds the handle after a display name. A named thing is a
 * list or a starter pack.
 */
export type Inline = string | { actor: Actor; full: boolean } | { name: string; url: string };

export interface Line {
  sentence: Inline[];
  /** Shown one per line under the sentence, for groups longer than MAX_JOINED. */
  items?: Inline[][];
}

export interface Section {
  handle: string;
  did: string;
  lines: Line[];
}

export interface Report {
  text: string;
  html: string;
}

export function profileUrl(a: Actor): string {
  return `https://bsky.app/profile/${a.did}`;
}

function rkeyOf(uri: string): string {
  return uri.split("/").pop() ?? "";
}

function listUrl(l: ListRef): string {
  return `https://bsky.app/profile/${l.owner.did}/lists/${rkeyOf(l.uri)}`;
}

function packUrl(ownerDid: string, uri: string): string {
  return `https://bsky.app/starter-pack/${ownerDid}/${rkeyOf(uri)}`;
}

/** Display name with whitespace collapsed, or undefined when there is none to show. */
function displayName(a: Actor): string | undefined {
  const name = a.displayName?.replace(/\s+/g, " ").trim();
  return name === undefined || name === "" ? undefined : name;
}

/** @handle, or the bare DID when the account has no handle any more. */
function handleText(a: Actor): string {
  return a.handle === a.did ? a.did : `@${a.handle}`;
}

function inlineText(i: Inline): string {
  if (typeof i === "string") return i;
  if ("name" in i) return i.name;
  const name = displayName(i.actor);
  if (name === undefined) return handleText(i.actor);
  return i.full ? `${name} (${handleText(i.actor)})` : name;
}

/** a; a and b; a, b and c. */
export function joinAnd(parts: Inline[][]): Inline[] {
  const out: Inline[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(i === parts.length - 1 ? " and " : ", ");
    out.push(...p);
  });
  return out;
}

/** A name that already ends in . ! or ? ends the sentence; drop the extra full stop. */
function sentence(parts: Inline[]): Inline[] {
  const before = parts.at(-2);
  if (parts.at(-1) === "." && before !== undefined && /[.!?]$/.test(inlineText(before))) return parts.slice(0, -1);
  return parts;
}

const short = (a: Actor): Inline[] => [{ actor: a, full: false }];
const full = (a: Actor): Inline[] => [{ actor: a, full: true }];
const list = (l: ListRef): Inline[] => [{ name: l.name, url: listUrl(l) }];
const pack = (p: StarterPackRef): Inline[] => [{ name: p.name, url: packUrl(p.owner.did, p.uri) }];

/**
 * One line about a group of actors. A single actor gets name and handle, a
 * small group is joined into the sentence, a long group is listed under it.
 */
function group(actors: Actor[], few: (who: Inline[], n: number) => Inline[], many: (n: number) => Inline[]): Line[] {
  const [only] = actors;
  if (only === undefined) return [];
  if (actors.length === 1) return [{ sentence: sentence(few(full(only), 1)) }];
  if (actors.length <= MAX_JOINED) return [{ sentence: sentence(few(joinAnd(actors.map(short)), actors.length)) }];
  return [{ sentence: many(actors.length), items: actors.map(full) }];
}

export function buildSection(c: AccountChanges): Section {
  const lines: Line[] = [];
  lines.push(
    ...group(
      c.newFollowers,
      (w, n) => (n === 1 ? [...w, " followed you."] : [`${n} new followers: `, ...w, "."]),
      (n) => [`${n} new followers:`],
    ),
  );
  const byPack = new Map<string, { pack: StarterPackRef; followers: Actor[] }>();
  for (const s of c.starterPackFollows) {
    const entry = byPack.get(s.packUri) ?? {
      pack: { uri: s.packUri, name: s.packName, owner: s.packOwner },
      followers: [],
    };
    entry.followers.push(s.follower);
    byPack.set(s.packUri, entry);
  }
  for (const { pack: p, followers } of byPack.values()) {
    const via: Inline[] = [" through the starter pack ", ...pack(p), " by ", ...short(p.owner)];
    lines.push(
      ...group(
        followers,
        (w) => [...w, " joined Bluesky", ...via, "."],
        (n) => [`${n} new followers joined Bluesky`, ...via, ":"],
      ),
    );
  }
  lines.push(...group(c.unfollows, (w) => [...w, " unfollowed you."], (n) => [`${n} accounts unfollowed you:`]));
  lines.push(...group(c.blockedBy, (w) => [...w, " blocked you."], (n) => [`${n} accounts blocked you:`]));
  lines.push(...group(c.unblockedBy, (w) => [...w, " unblocked you."], (n) => [`${n} accounts unblocked you:`]));
  for (const l of c.addedToModLists) {
    lines.push({ sentence: sentence([...short(l.owner), " added you to the block list ", ...list(l), "."]) });
  }
  for (const l of c.removedFromModLists) {
    lines.push({ sentence: sentence(["Removed from the block list ", ...list(l), " by ", ...short(l.owner), "."]) });
  }
  for (const s of c.subscriberChanges) {
    const on: Inline[] = [" the block list ", ...list(s.list), " by ", ...short(s.list.owner)];
    lines.push(
      ...group(s.gained, (w) => [...w, " subscribed to", ...on, "."], (n) => [`${n} accounts subscribed to`, ...on, ":"]),
    );
    lines.push(
      ...group(
        s.lost,
        (w) => [...w, " unsubscribed from", ...on, "."],
        (n) => [`${n} accounts unsubscribed from`, ...on, ":"],
      ),
    );
  }
  for (const p of c.addedToStarterPacks) {
    lines.push({ sentence: sentence([...short(p.owner), " added you to the starter pack ", ...pack(p), "."]) });
  }
  for (const p of c.removedFromStarterPacks) {
    lines.push({ sentence: sentence(["Removed from the starter pack ", ...pack(p), " by ", ...short(p.owner), "."]) });
  }
  for (const w of c.warnings) lines.push({ sentence: [/[.!?]$/.test(w) ? w : `${w}.`] });
  return { handle: c.handle, did: c.did, lines };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line across all accounts checked, counts only. */
export function summarize(all: AccountChanges[]): string {
  const sum = (f: (c: AccountChanges) => number) => all.reduce((n, c) => n + f(c), 0);
  const counts: [number, string, string][] = [
    [sum((c) => c.newFollowers.length), "new follower", "new followers"],
    [sum((c) => c.unfollows.length), "unfollow", "unfollows"],
    [sum((c) => c.blockedBy.length), "new block", "new blocks"],
    [sum((c) => c.unblockedBy.length), "unblock", "unblocks"],
    [sum((c) => c.addedToModLists.length), "block list addition", "block list additions"],
    [sum((c) => c.removedFromModLists.length), "block list removal", "block list removals"],
    [
      sum((c) => c.subscriberChanges.reduce((n, s) => n + s.gained.length, 0)),
      "new block list subscriber",
      "new block list subscribers",
    ],
    [
      sum((c) => c.subscriberChanges.reduce((n, s) => n + s.lost.length, 0)),
      "ended block list subscription",
      "ended block list subscriptions",
    ],
    [sum((c) => c.addedToStarterPacks.length), "starter pack addition", "starter pack additions"],
    [sum((c) => c.removedFromStarterPacks.length), "starter pack removal", "starter pack removals"],
  ];
  const parts = counts.filter(([n]) => n > 0).map(([n, one, many]) => [plural(n, one, many)]);
  const accounts = plural(all.length, "account", "accounts");
  const notChecked = all.some((c) => c.warnings.length > 0) ? " Some checks could not run." : "";
  if (parts.length === 0) return `No changes across ${accounts}.${notChecked}`;
  const joined = joinAnd(parts).map(inlineText).join("");
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} across ${accounts}.${notChecked}`;
}

export function renderText(summary: string, sections: Section[]): string {
  const blocks = sections.map((s) => {
    const out = [`@${s.handle}`];
    for (const l of s.lines) {
      out.push(l.sentence.map(inlineText).join(""));
      for (const item of l.items ?? []) out.push(`  - ${item.map(inlineText).join("")}`);
    }
    return out.join("\n");
  });
  return `${[summary, ...blocks].join("\n\n")}\n`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function link(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="color:inherit;text-decoration:underline;">${escapeHtml(label)}</a>`;
}

function inlineHtml(i: Inline): string {
  if (typeof i === "string") return escapeHtml(i);
  if ("name" in i) return link(i.name, i.url);
  const name = displayName(i.actor);
  const url = profileUrl(i.actor);
  if (name === undefined) return link(handleText(i.actor), url);
  return i.full ? `${link(name, url)} (${escapeHtml(handleText(i.actor))})` : link(name, url);
}

// Inline styles only and no colours, so the mail client's light or dark theme
// applies. No images and nothing loaded from outside the message.
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

export function renderHtml(summary: string, sections: Section[]): string {
  const body: string[] = [`<p style="margin:0 0 20px 0;">${escapeHtml(summary)}</p>`];
  for (const s of sections) {
    const heading = link(`@${s.handle}`, `https://bsky.app/profile/${s.did}`);
    body.push(`<h2 style="font-size:17px;line-height:1.4;margin:28px 0 8px 0;font-weight:600;">${heading}</h2>`);
    for (const l of s.lines) {
      body.push(`<p style="margin:0 0 8px 0;">${l.sentence.map(inlineHtml).join("")}</p>`);
      if (l.items !== undefined) {
        const items = l.items.map((item) => `<li>${item.map(inlineHtml).join("")}</li>`).join("");
        body.push(`<ul style="margin:0 0 12px 0;padding-left:22px;">${items}</ul>`);
      }
    }
  }
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    "</head>",
    `<body style="margin:0;padding:20px;${FONT}font-size:16px;line-height:1.55;">`,
    '<div style="max-width:600px;">',
    ...body,
    "</div>",
    "</body></html>",
    "",
  ].join("\n");
}

/** null when no account has anything to report. */
export function renderReport(all: AccountChanges[]): Report | null {
  const changed = all.filter(hasChanges);
  if (changed.length === 0) return null;
  const summary = summarize(all);
  const sections = changed.map(buildSection);
  return { text: renderText(summary, sections), html: renderHtml(summary, sections) };
}
