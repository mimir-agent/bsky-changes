// A guess at which accounts are bots, from fields the profile lookup already
// returns, so it costs no extra requests. Nothing in the protocol says for sure
// that an account is a bot; the report says "likely" and only groups accounts.
import type { Profile } from "./types.ts";

export const MASS_FOLLOW_MIN = 500;
export const MASS_FOLLOW_RATIO = 20;

/** The rule below in one plain sentence, shown in the report next to any likely bots. */
export const BOT_RULE =
  `An account counts as a likely bot when it labels itself a bot, or when it follows at least ` +
  `${MASS_FOLLOW_MIN} accounts, ${MASS_FOLLOW_RATIO} times as many as follow it, and has no posts.`;

/**
 * True when the account carries the "bot" self-label (what Bluesky's
 * automation label setting writes), or looks like a mass-follow account.
 * Counts the AppView did not return give no signal.
 */
export function looksLikeBot(p: Profile): boolean {
  if (p.selfLabels?.includes("bot") === true) return true;
  const { followsCount: follows, followersCount: followers, postsCount: posts } = p;
  if (follows === undefined || followers === undefined || posts === undefined) return false;
  return follows >= MASS_FOLLOW_MIN && follows >= MASS_FOLLOW_RATIO * followers && posts === 0;
}
