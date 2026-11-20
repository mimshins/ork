/**
 * @file Seeding a new worktree (RFC-022 option D, ADR-114): copying named files
 *   from a folder outside the repository (an attached project's Ork folder)
 *   into the worktree, and committing them once, detached, so a node works on
 *   them and its change is measured from that commit. Only plain files inside
 *   both folders are copied; the commit runs no commit hook and ignores
 *   `.gitignore`.
 */

import { copyFileSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

import { plainPathInside } from "../project/plain-files.ts";
import { git, gitOk } from "./git.ts";

/** Files to commit into a new worktree before a node works there. */
export type WorktreeSeed = {
  /** The folder the files are read from. */
  from: string;
  /** Where they go, relative to the worktree (e.g. `.ork`, `app/.ork`). */
  to: string;
  /**
   * The files, relative to `from`. A missing one, one that is a link or behind
   * one, or a path that leaves either folder is skipped.
   */
  paths: readonly string[];
};

/** The identity of the seed commit when the repository names none. */
const ORK_IDENTITY = ["-c", "user.name=Ork", "-c", "user.email=ork@localhost"];

/** A relative path with no step out of its folder. */
const contained = (relative: string): boolean =>
  relative !== "" &&
  !path.isAbsolute(relative) &&
  !relative.split(/[\\/]/u).includes("..");

const isFile = (file: string): boolean => {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
};

/** The repository's identity when it has one, Ork's otherwise. */
const identity = async (worktree: string): Promise<string[]> => {
  const name = await git(worktree, ["config", "user.name"]);
  const email = await git(worktree, ["config", "user.email"]);
  return name.code === 0 && email.code === 0 ? [] : ORK_IDENTITY;
};

/**
 * Copies the seed's plain files into `worktree`; returns them,
 * worktree-relative.
 */
const copySeed = (worktree: string, seed: WorktreeSeed): string[] => {
  if (!contained(seed.to)) {
    throw new Error(`the seed's folder ${seed.to} leaves the worktree`);
  }
  const into = path.join(worktree, seed.to);
  if (!plainPathInside(worktree, into)) {
    throw new Error(
      `${seed.to} is a link, or behind one, in the worktree: Ork seeds only plain folders`,
    );
  }
  const copied: string[] = [];
  for (const file of seed.paths.filter(contained)) {
    const source = path.join(seed.from, file);
    const target = path.join(into, file);
    if (
      !plainPathInside(seed.from, source) ||
      !isFile(source) ||
      !plainPathInside(worktree, target)
    ) {
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    copied.push(path.relative(worktree, target));
  }
  return copied;
};

/**
 * Seeds the detached `worktree`: copies the files, then commits them once with
 * `git add -f` and plumbing (no commit hook, no signing), and moves `HEAD` to
 * that commit. Returns the commit `HEAD` is on after it: the seed commit, or
 * the worktree's own commit when nothing was copied or nothing changed.
 */
export const seedWorktree = async (
  worktree: string,
  seed: WorktreeSeed,
): Promise<string> => {
  const head = (await gitOk(worktree, ["rev-parse", "HEAD"])).trim();
  const copied = copySeed(worktree, seed);
  if (copied.length === 0) return head;
  await gitOk(worktree, ["add", "-f", "--", ...copied]);
  const tree = (await gitOk(worktree, ["write-tree"])).trim();
  const before = (await gitOk(worktree, ["rev-parse", "HEAD^{tree}"])).trim();
  if (tree === before) return head;
  const commit = (
    await gitOk(worktree, [
      ...(await identity(worktree)),
      "commit-tree",
      "--no-gpg-sign",
      tree,
      "-p",
      head,
      "-m",
      `ork: seed ${seed.to}`,
    ])
  ).trim();
  await gitOk(worktree, ["update-ref", "--no-deref", "HEAD", commit, head]);
  return commit;
};
