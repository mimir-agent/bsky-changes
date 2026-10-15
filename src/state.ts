// One JSON file per watched account, named by DID so a handle change keeps
// its history. Written to a temp file and renamed, so a crash mid-write
// leaves the previous snapshot intact.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountState } from "./types.ts";

function fileFor(stateDir: string, did: string): string {
  return join(stateDir, `${did.replaceAll(":", "_")}.json`);
}

export function readState(stateDir: string, did: string): AccountState | null {
  let text: string;
  try {
    text = readFileSync(fileFor(stateDir, did), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const state = JSON.parse(text) as AccountState;
  if (state.version !== 1 || state.did !== did) {
    throw new Error(`state file for ${did} has an unexpected format; move it aside to start a new baseline`);
  }
  return state;
}

export function writeState(stateDir: string, state: AccountState): void {
  mkdirSync(stateDir, { recursive: true });
  const path = fileFor(stateDir, state.did);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
}
