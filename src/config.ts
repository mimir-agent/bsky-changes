// The config file lives outside the repo. Default location:
// ~/.config/bsky-changes/config.json, or the path given with --config.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  accounts: string[];
  stateDir: string;
  email?: { to: string };
}

export function defaultConfigPath(): string {
  return join(homedir(), ".config", "bsky-changes", "config.json");
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

export function parseConfig(text: string, where: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${where}: not valid JSON (${(err as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null) throw new Error(`${where}: expected a JSON object`);
  const o = raw as Record<string, unknown>;
  const accounts = o.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts.every((a) => typeof a === "string" && a !== "")) {
    throw new Error(`${where}: "accounts" must be a non-empty list of handles`);
  }
  if (typeof o.stateDir !== "string" || o.stateDir === "") {
    throw new Error(`${where}: "stateDir" must be a path`);
  }
  const config: Config = {
    accounts: accounts.map((a: string) => a.replace(/^@/, "")),
    stateDir: expandHome(o.stateDir),
  };
  if (o.email !== undefined) {
    const email = o.email as Record<string, unknown> | null;
    if (typeof email !== "object" || email === null || typeof email.to !== "string" || email.to === "") {
      throw new Error(`${where}: "email.to" must be an address`);
    }
    config.email = { to: email.to };
  }
  return config;
}

export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read config ${path}: ${(err as Error).message}`);
  }
  return parseConfig(text, path);
}
