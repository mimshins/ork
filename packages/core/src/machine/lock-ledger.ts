/**
 * @file The machine-wide ledger of named locks (RFC-016): one run at a time
 *   holds a lock, such as the branch it integrates into. Each lock is a slot
 *   ledger with one slot (ADR-080's mechanism: hard-link records, tickets first
 *   come, first served, a dead holder's record swept), in its own folder under
 *   `~/.ork/locks`, named by a hash of its key. A `branch:<name>` lock is keyed
 *   by the origin's URL (without its user part) and the branch, so clones of
 *   one remote share it; any other name by the project's root and the name.
 */

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { git } from "../worktree/git.ts";
import {
  fileSlotLedger,
  type HeldSlot,
  type SlotLedger,
} from "./slot-ledger.ts";

/** The ledgers of a run's locks, by a lock's name as the run renders it. */
export type LockLedgers = {
  of: (name: string) => Promise<SlotLedger>;
};

const BRANCH = "branch:";

/**
 * A remote's URL as a key: no scheme, no user part (where a token may sit), no
 * `.git`; `git@host:path` and `https://host/path` read the same.
 */
export const remoteKey = (url: string): string => {
  const trimmed = url
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "");
  const scheme = /^[a-z][\d+.a-z-]*:\/\//iu.exec(trimmed);
  if (scheme !== null) {
    return trimmed.slice(scheme[0].length).replace(/^[^/@]*@/u, "");
  }
  // scp-like `user@host:path`; a bare path (a local remote) stays as it is.
  const scp = /^(?:[^/@]+@)?([^/:]+):(?!\/)(.*)$/u.exec(trimmed);
  return scp === null ? trimmed : `${scp[1] ?? ""}/${scp[2] ?? ""}`;
};

/** The origin's URL as a key, or `undefined` when the repo has no origin. */
const originOf = async (repo: string): Promise<string | undefined> => {
  const result = await git(repo, ["remote", "get-url", "origin"]);
  const url = result.stdout.trim();
  return result.code === 0 && url !== "" ? remoteKey(url) : undefined;
};

/**
 * A lock's key: `branch:<origin>#<branch>` for a branch lock (the repo's own
 * folder when it has no origin), else `<project>#<name>`.
 */
export const lockKey = async (
  name: string,
  place: { repo: string; project: string },
): Promise<string> =>
  name.startsWith(BRANCH)
    ? `${BRANCH}${(await originOf(place.repo)) ?? path.resolve(place.repo)}#${name.slice(BRANCH.length)}`
    : `${path.resolve(place.project)}#${name}`;

/**
 * Whether a lock's key falls back to the repo's own path: a `branch:` lock in a
 * repo with no origin, which no other clone shares.
 */
export const lockIsLocal = async (
  name: string,
  place: { repo: string },
): Promise<boolean> =>
  name.startsWith(BRANCH) && (await originOf(place.repo)) === undefined;

/** A key's folder name: a hash, so no URL or path is written as a name. */
const folderOf = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 32);

/** The locks in `dir`, for a run in `repo` of `project`. */
export const fileLockLedgers = (options: {
  dir: string;
  repo: string;
  project: string;
  pollMs?: number;
}): LockLedgers => ({
  of: async name =>
    fileSlotLedger({
      dir: path.join(options.dir, folderOf(await lockKey(name, options))),
      slots: 1,
      ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    }),
});

/** Where the machine's locks are: `~/.ork/locks`. */
export const machineLocksDir = (home: string = homedir()): string =>
  path.join(home, ".ork", "locks");

/** The machine's locks (in `home`'s), for a run in `repo` of `project`. */
export const machineLockLedgers = (
  repo: string,
  project: string,
  home?: string,
): LockLedgers =>
  fileLockLedgers({ repo, project, dir: machineLocksDir(home) });

/** Drops every lock's records and tickets whose process is gone; returns them. */
export const sweepLocks = (dir: string): HeldSlot[] => {
  let folders: string[];
  try {
    folders = readdirSync(dir);
  } catch {
    return [];
  }
  // shortcut: a lock's folder stays once made, empty; a few bytes per branch.
  return folders.flatMap(folder =>
    fileSlotLedger({ dir: path.join(dir, folder), slots: 1 }).sweep(),
  );
};
