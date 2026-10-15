import { parseArgs } from "node:util";
import { checkAccount, type AccountChanges, type CheckResult } from "./check.ts";
import { defaultConfigPath, loadConfig } from "./config.ts";
import { sendReport, smtpFromEnv, subjectFor } from "./email.ts";
import { Http } from "./http.ts";
import { NetworkSource } from "./network.ts";
import { renderReport } from "./report.ts";
import { readState, writeState } from "./state.ts";
import type { Source } from "./types.ts";

const HELP = `Usage: bsky-changes [options]

Reports changes to the Bluesky social graph of the accounts in the config:
new followers and unfollows, blocks, block lists (moderation lists),
starter packs the account was added to or removed from, and new followers
who joined through a starter pack that includes the account.
Prints nothing when nothing changed. The first run for an account only
records a baseline.

Options:
  --config PATH  config file (default: ~/.config/bsky-changes/config.json)
  --email        send the report by email instead of printing it
                 (needs EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_SMTP_HOST,
                 EMAIL_SMTP_PORT in the environment, and email.to in the config)
  --dry-run      do everything except saving state and sending email
  --verbose      print per-account counts to stderr (no names)
  --help         show this help
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  source: () => Source;
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  env: process.env,
  now: () => new Date(),
  source: () => new NetworkSource(new Http({ maxConcurrent: 4 })),
};

function countsLine(handle: string, r: CheckResult): string {
  const c = r.counts;
  const show = (n: number | null) => (n === null ? "not checked" : String(n));
  const baseline = c.baseline.length > 0 ? `; baseline recorded for ${c.baseline.join(", ")}` : "";
  return `@${handle}: ${c.followers} followers, ${show(c.blockers)} blockers, ${show(c.modLists)} mod lists, ${show(c.starterPacks)} starter packs${baseline}\n`;
}

/** Returns the exit code: 0 on success, 1 when any account failed, 2 on bad usage. */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        config: { type: "string" },
        email: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    io.err(`bsky-changes: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  const dryRun = values["dry-run"];

  let config;
  try {
    config = loadConfig(values.config ?? defaultConfigPath());
  } catch (err) {
    io.err(`bsky-changes: ${(err as Error).message}\n`);
    return 2;
  }
  // Check delivery settings before doing any work, so a bad setup fails fast.
  let smtp;
  if (values.email && !dryRun) {
    try {
      if (config.email === undefined) throw new Error('--email needs "email.to" in the config');
      smtp = smtpFromEnv(io.env);
    } catch (err) {
      io.err(`bsky-changes: ${(err as Error).message}\n`);
      return 2;
    }
  }

  const source = io.source();
  const changes: AccountChanges[] = [];
  let failed = false;
  for (const handle of config.accounts) {
    try {
      const did = await source.resolveHandle(handle);
      const previous = readState(config.stateDir, did);
      const result = await checkAccount(source, handle, did, previous);
      changes.push(result.changes);
      if (values.verbose) io.err(countsLine(handle, result));
      if (!dryRun) writeState(config.stateDir, result.state);
    } catch (err) {
      failed = true;
      io.err(`bsky-changes: @${handle} could not be checked: ${(err as Error).message}\n`);
    }
  }

  const report = renderReport(changes);
  if (report !== "") {
    if (smtp !== undefined && config.email !== undefined) {
      try {
        await sendReport(smtp, config.email.to, subjectFor(io.now()), report);
      } catch (err) {
        io.err(`bsky-changes: ${(err as Error).message}\n`);
        return 1;
      }
    } else {
      io.out(report);
    }
  }
  return failed ? 1 : 0;
}
