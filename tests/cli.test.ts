import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type Io } from "../src/cli.ts";
import { FakeSource, WATCHED, actor, world, type World } from "./fixtures.ts";

function setup(w: World, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bsky-changes-test-"));
  const stateDir = join(dir, "state");
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ accounts: [WATCHED.handle], stateDir, ...extra }));
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    env: {},
    now: () => new Date("2026-01-02T03:04:05Z"),
    source: () => new FakeSource(w),
  };
  return { dir, stateDir, config, out, err, io, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("baseline run prints nothing and saves state; an unchanged second run prints nothing", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  assert.equal(await main(["--config", s.config], s.io), 0);
  assert.equal(s.out.join(""), "");
  assert.equal(readdirSync(s.stateDir).length, 1);
  assert.equal(await main(["--config", s.config], s.io), 0);
  assert.equal(s.out.join(""), "");
});

test("--dry-run saves no state", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  assert.equal(await main(["--config", s.config, "--dry-run", "--verbose"], s.io), 0);
  assert.equal(s.out.join(""), "");
  assert.deepEqual(readdirSync(s.dir), ["config.json"]);
  assert.match(s.err.join(""), /1 followers, 0 blockers, 0 mod lists, 0 starter packs; baseline recorded for followers, blocks, mod lists, starter packs/);
});

test("changes are printed to stdout", async (t) => {
  const w = world({ followers: [actor(1)] });
  const s = setup(w);
  t.after(s.cleanup);
  await main(["--config", s.config], s.io);
  w.followers = [actor(1), actor(2)];
  assert.equal(await main(["--config", s.config], s.io), 0);
  assert.match(s.out.join(""), /New followers \(1\)\n {4}@user2\.example\.com/);
});

test("--email without the environment fails before doing any work and names only the variables", async (t) => {
  const s = setup(world(), { email: { to: "someone@example.com" } });
  t.after(s.cleanup);
  s.io.env = { EMAIL_ADDRESS: "sender@example.com", EMAIL_PASSWORD: "hunter2-secret" };
  assert.equal(await main(["--config", s.config, "--email"], s.io), 2);
  const err = s.err.join("");
  assert.match(err, /EMAIL_SMTP_HOST, EMAIL_SMTP_PORT/);
  assert.doesNotMatch(err, /hunter2-secret/);
  assert.doesNotMatch(err, /sender@example\.com/);
});

test("an account that cannot be resolved exits 1 and the others still run", async (t) => {
  const s = setup(world({ followers: [actor(1)] }));
  t.after(s.cleanup);
  writeFileSync(s.config, JSON.stringify({ accounts: ["nobody.example.com", WATCHED.handle], stateDir: s.stateDir }));
  assert.equal(await main(["--config", s.config], s.io), 1);
  assert.match(s.err.join(""), /@nobody\.example\.com could not be checked/);
  assert.equal(readdirSync(s.stateDir).length, 1);
});
