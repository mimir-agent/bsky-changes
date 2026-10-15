import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildSection, escapeHtml, joinAnd, renderReport, renderText, summarize, type Inline } from "../src/report.ts";
import { everyKind, noChanges, person } from "./report-fixture.ts";

const DID = "did:plc:alice00000000000000000";

function text(c: ReturnType<typeof noChanges>): string {
  return renderReport([c])?.text ?? "";
}

function withFollowers(n: number) {
  return { ...noChanges("alice.example.com", DID), newFollowers: Array.from({ length: n }, (_, i) => person(i + 1, `Name ${i + 1}`)) };
}

test("joinAnd joins 1, 2 and 3 items as a sentence", () => {
  const j = (xs: string[]) => joinAnd(xs.map((x): Inline[] => [x])).join("");
  assert.equal(j(["A"]), "A");
  assert.equal(j(["A", "B"]), "A and B");
  assert.equal(j(["A", "B", "C"]), "A, B and C");
});

test("one new follower gets name and handle", () => {
  assert.match(text(withFollowers(1)), /^Name 1 \(@user1\.example\.com\) followed you\.$/m);
});

test("two and three new followers are joined into one sentence", () => {
  assert.match(text(withFollowers(2)), /^2 new followers: Name 1 and Name 2\.$/m);
  assert.match(text(withFollowers(3)), /^3 new followers: Name 1, Name 2 and Name 3\.$/m);
});

test("more than eight followers are listed one per line", () => {
  const t = text(withFollowers(9));
  assert.match(t, /^9 new followers:\n {2}- Name 1 \(@user1\.example\.com\)\n/m);
  assert.match(t, /^ {2}- Name 9 \(@user9\.example\.com\)$/m);
  assert.equal(renderReport([withFollowers(8)])?.text.includes("\n  - "), false);
});

test("an account with no display name is shown by handle", () => {
  const c = { ...noChanges("alice.example.com", DID), blockedBy: [person(4)] };
  assert.match(text(c), /^@user4\.example\.com blocked you\.$/m);
  assert.match(renderReport([c])?.html ?? "", />@user4\.example\.com<\/a> blocked you\./);
});

test("every change kind renders as a sentence", () => {
  const report = renderReport(everyKind());
  assert.ok(report !== null);
  const lines = report.text.split("\n");
  for (const expected of [
    "11 new followers, 1 unfollow, 1 new block, 1 unblock, 1 block list addition, 1 block list removal, 3 new block list subscribers, 1 ended block list subscription, 1 starter pack addition and 1 starter pack removal across 3 accounts. Some checks could not run.",
    "@alice.example.com",
    "2 new followers: Bob Builder and @user2.example.com.",
    "@user2.example.com joined Bluesky through the starter pack Cider makers by Erin Packs.",
    "Carol (@user3.example.com) unfollowed you.",
    "Skalman (@user4.example.com) blocked you.",
    "@user5.example.com unblocked you.",
    "Dana Owner added you to the block list Spam accounts.",
    "Removed from the block list Reply guys by Dana Owner.",
    "Frank, Grace and @user8.example.com subscribed to the block list Spam accounts by Dana Owner.",
    "Heidi (@user9.example.com) unsubscribed from the block list Spam accounts by Dana Owner.",
    "Erin Packs added you to the starter pack If you need a starter pack, use this.",
    "Removed from the starter pack Old friends by Dana Owner.",
    "@alice-alt.example.com",
    "9 new followers:",
    "Blocks could not be checked: Constellation did not answer: HTTP 503.",
  ]) {
    assert.ok(lines.includes(expected), `missing line: ${expected}\n---\n${report.text}`);
  }
  // Only accounts with changes get a section.
  assert.doesNotMatch(report.text, /quiet\.example\.com/);
});

test("the plain text has no URLs", () => {
  const report = renderReport(everyKind());
  assert.doesNotMatch(report?.text ?? "", /https?:|at:\/\//);
});

test("the HTML links every account, list and pack by name, never by URL", () => {
  const html = renderReport(everyKind())?.html ?? "";
  const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)];
  assert.ok(anchors.length > 15);
  for (const [, href, label] of anchors) {
    assert.match(href ?? "", /^https:\/\/bsky\.app\/(profile|starter-pack)\//);
    assert.doesNotMatch(label ?? "", /https?:|bsky\.app|did:|at:\/\//, `raw URL as link text: ${label}`);
  }
  assert.match(html, /<a href="https:\/\/bsky\.app\/profile\/did:plc:fake0+4"[^>]*>Skalman<\/a> \(@user4\.example\.com\) blocked you\./);
  assert.match(html, /<a href="https:\/\/bsky\.app\/profile\/did:plc:fake0+90\/lists\/mod1"[^>]*>Spam accounts<\/a>/);
  assert.match(html, /<a href="https:\/\/bsky\.app\/starter-pack\/did:plc:fake0+91\/sp1"[^>]*>Cider makers<\/a>/);
  // Nothing outside the message is loaded, and nothing is styled from outside.
  assert.doesNotMatch(html, /<img|<link|<script|<style|src=|url\(/i);
});

test("display names, list names and pack names are escaped in the HTML", () => {
  const evil = person(4, `<script>alert("x")</script> & co`);
  const c = {
    ...noChanges("alice.example.com", DID),
    blockedBy: [evil],
    addedToModLists: [{ uri: "at://did:plc:o/app.bsky.graph.list/l1", name: "<b>Lists</b> & more", owner: evil }],
  };
  const html = renderReport([c])?.html ?? "";
  assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; co/);
  assert.match(html, /&lt;b&gt;Lists&lt;\/b&gt; &amp; more/);
  assert.equal(escapeHtml(`<a href='x'>&</a>`), "&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
});

test("a name ending in a full stop does not get a second one", () => {
  const sections = everyKind().slice(0, 1).map(buildSection);
  assert.match(renderText("", sections), /use this\.\n/);
  assert.doesNotMatch(renderText("", sections), /use this\.\./);
});

test("the summary counts across accounts and names a quiet run", () => {
  assert.equal(summarize([withFollowers(2), noChanges("b.example.com", "did:plc:b")]), "2 new followers across 2 accounts.");
  assert.equal(
    summarize([{ ...noChanges("a.example.com", DID), warnings: ["Blocks could not be checked"] }]),
    "No changes across 1 account. Some checks could not run.",
  );
});

test("no changes anywhere means no report", () => {
  assert.equal(renderReport([noChanges("a.example.com", DID)]), null);
});
