// Plain-text report of changes only. Accounts with nothing to say are left
// out; when no account has anything, the report is the empty string.
import { hasChanges, type AccountChanges, type ListRef, type StarterPackRef } from "./check.ts";
import type { Actor } from "./types.ts";

export function profileUrl(a: Actor): string {
  return `https://bsky.app/profile/${a.did}`;
}

function who(a: Actor): string {
  const name = a.handle === a.did ? a.did : `@${a.handle}`;
  const display = a.displayName !== undefined ? ` (${a.displayName})` : "";
  return `${name}${display} ${profileUrl(a)}`;
}

function rkeyOf(uri: string): string {
  return uri.split("/").pop() ?? "";
}

function listName(l: ListRef): string {
  return `"${l.name}" by @${l.owner.handle} https://bsky.app/profile/${l.owner.did}/lists/${rkeyOf(l.uri)}`;
}

/** A list, then who owns it with a link to their profile. */
function listWithOwner(l: ListRef): string {
  return `"${l.name}" https://bsky.app/profile/${l.owner.did}/lists/${rkeyOf(l.uri)}, owned by ${who(l.owner)}`;
}

function packLine(verb: string, p: StarterPackRef): string {
  return `${verb} "${p.name}" https://bsky.app/starter-pack/${p.owner.did}/${rkeyOf(p.uri)} by ${who(p.owner)}`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`  ${title} (${lines.length})`, ...lines.map((l) => `    ${l}`)];
}

export function renderAccount(c: AccountChanges): string {
  const lines: string[] = [`@${c.handle}`];
  lines.push(...section("New followers", c.newFollowers.map(who)));
  lines.push(...section("Unfollowed", c.unfollows.map(who)));
  lines.push(
    ...section(
      "Joined through a starter pack that includes you",
      c.starterPackFollows.map((s) => `${who(s.follower)} joined via "${s.packName}" by @${s.packOwner.handle}`),
    ),
  );
  lines.push(...section("Blocked you", c.blockedBy.map(who)));
  lines.push(...section("Unblocked you", c.unblockedBy.map(who)));
  lines.push(...section("Added to block lists", c.addedToModLists.map(listWithOwner)));
  lines.push(...section("Removed from block lists", c.removedFromModLists.map(listWithOwner)));
  for (const s of c.subscriberChanges) {
    lines.push(...section(`New block subscribers to ${listName(s.list)}`, s.gained.map(who)));
    lines.push(...section(`Ended block subscriptions to ${listName(s.list)}`, s.lost.map(who)));
  }
  lines.push(
    ...section(
      "Added to starter packs",
      c.addedToStarterPacks.map((p) => packLine("Added to starter pack", p)),
    ),
  );
  lines.push(
    ...section(
      "Removed from starter packs",
      c.removedFromStarterPacks.map((p) => packLine("Removed from starter pack", p)),
    ),
  );
  lines.push(...section("Not checked", c.warnings));
  return lines.join("\n");
}

export function renderReport(all: AccountChanges[]): string {
  const parts = all.filter(hasChanges).map(renderAccount);
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
