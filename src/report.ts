// Plain-text report of changes only. Accounts with nothing to say are left
// out; when no account has anything, the report is the empty string.
import { hasChanges, type AccountChanges, type ListRef } from "./check.ts";
import type { Actor } from "./types.ts";

export function profileUrl(a: Actor): string {
  return `https://bsky.app/profile/${a.did}`;
}

function who(a: Actor): string {
  const name = a.handle === a.did ? a.did : `@${a.handle}`;
  const display = a.displayName !== undefined ? ` (${a.displayName})` : "";
  return `${name}${display} ${profileUrl(a)}`;
}

function listName(l: ListRef): string {
  const rkey = l.uri.split("/").pop() ?? "";
  return `"${l.name}" by @${l.owner.handle} https://bsky.app/profile/${l.owner.did}/lists/${rkey}`;
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
  lines.push(...section("Added to a moderation list", c.addedToModLists.map(listName)));
  lines.push(...section("Removed from a moderation list", c.removedFromModLists.map(listName)));
  for (const s of c.subscriberChanges) {
    lines.push(...section(`New block subscribers to ${listName(s.list)}`, s.gained.map(who)));
    lines.push(...section(`Ended block subscriptions to ${listName(s.list)}`, s.lost.map(who)));
  }
  lines.push(...section("Not checked", c.warnings));
  return lines.join("\n");
}

export function renderReport(all: AccountChanges[]): string {
  const parts = all.filter(hasChanges).map(renderAccount);
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
