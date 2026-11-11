/**
 * @file The passes of checks run once, kept in `<git-common-dir>/ork-once/`,
 *   outside every worktree and shared by all of them. A pass is one JSON file
 *   per check name, files and Node version; it holds the tree, `HEAD`, the time
 *   and who ran it, nothing else. Only a passing run writes one (Ork's process
 *   or the check's own, never an agent's edit). Pruned past 7 days or 500
 *   entries.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { TreeKey } from "./key.ts";

/** A check that passed on these files. */
export type OncePass = {
  /** The check's name (`--as`, or a name it covers). */
  name: string;
  tree: string;
  head: string | null;
  /** Node's version when it ran (`process.version`). */
  node: string;
  /** When it passed, ISO 8601. */
  at: string;
  /** Who ran it: `<run>/<node>` for Ork, `you` from a terminal. */
  who: string;
};

export const ONCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ONCE_MAX_ENTRIES = 500;

/** The folder of passes for a repository's common git folder. */
export const onceDirOf = (commonDir: string): string =>
  path.join(commonDir, "ork-once");

const fileOf = (dir: string, name: string, tree: string, node: string) =>
  path.join(
    dir,
    `${createHash("sha256")
      .update(JSON.stringify([name, tree, node]))
      .digest("hex")}.json`,
  );

const read = (file: string): OncePass | null => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !(
        "name" in value &&
        "tree" in value &&
        "head" in value &&
        "node" in value &&
        "at" in value &&
        "who" in value
      )
    ) {
      return null;
    }
    const { name, tree, head, node, at, who } = value;
    return typeof name === "string" &&
      typeof tree === "string" &&
      (typeof head === "string" || head === null) &&
      typeof node === "string" &&
      typeof at === "string" &&
      typeof who === "string"
      ? { name, tree, head, node, at, who }
      : null;
  } catch {
    return null;
  }
};

export type OnceLookup = {
  key: TreeKey;
  name: string;
  /** Require the same `HEAD` too (a check relative to it). */
  withHead?: boolean;
  /** Default `process.version`. */
  node?: string;
};

/** The pass of `name` on these files, or `null`. */
export const findPass = ({
  key,
  name,
  withHead = false,
  node = process.version,
}: OnceLookup): OncePass | null => {
  const pass = read(fileOf(onceDirOf(key.commonDir), name, key.tree, node));
  if (pass === null || pass.tree !== key.tree || pass.node !== node) {
    return null;
  }
  return withHead && pass.head !== key.head ? null : pass;
};

export type OnceRecord = {
  key: TreeKey;
  name: string;
  /** Other names the same pass counts for (a full check covers a partial). */
  covers?: readonly string[];
  who: string;
  node?: string;
  at?: Date;
};

/** Records a pass under `name` and each covered name, then prunes. */
export const recordPass = ({
  key,
  name,
  covers = [],
  who,
  node = process.version,
  at = new Date(),
}: OnceRecord): OncePass => {
  const dir = onceDirOf(key.commonDir);
  mkdirSync(dir, { recursive: true });
  const pass: OncePass = {
    name,
    tree: key.tree,
    head: key.head,
    node,
    at: at.toISOString(),
    who,
  };
  for (const each of [name, ...covers]) {
    // Write then rename, so a reader never sees half a file.
    const temp = path.join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(temp, `${JSON.stringify({ ...pass, name: each })}\n`);
    renameSync(temp, fileOf(dir, each, pass.tree, node));
  }
  prunePasses(key.commonDir, { now: at });
  return pass;
};

export type PruneOptions = {
  now?: Date;
  maxAgeMs?: number;
  maxEntries?: number;
};

/**
 * Removes passes older than `maxAgeMs` or past the newest `maxEntries`, and
 * files that don't read as a pass. Returns how many it removed.
 */
export const prunePasses = (
  commonDir: string,
  {
    now = new Date(),
    maxAgeMs = ONCE_MAX_AGE_MS,
    maxEntries = ONCE_MAX_ENTRIES,
  }: PruneOptions = {},
): number => {
  const dir = onceDirOf(commonDir);
  let names: string[];
  try {
    names = readdirSync(dir).filter(name => name.endsWith(".json"));
  } catch {
    return 0;
  }
  const kept: { file: string; at: number }[] = [];
  const stale: string[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const at = Date.parse(read(file)?.at ?? "");
    if (Number.isNaN(at) || now.getTime() - at > maxAgeMs) stale.push(file);
    else kept.push({ file, at });
  }
  kept.sort((a, b) => b.at - a.at);
  stale.push(...kept.slice(maxEntries).map(entry => entry.file));
  for (const file of stale) rmSync(file, { force: true });
  return stale.length;
};
