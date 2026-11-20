/**
 * @file The git half of renumbering what a change adds (`renumber.ts`): the
 *   commits a worktree's HEAD holds that no fetched ref has, the files they
 *   change, the lines they add, and the files a commit's tree holds.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/** Runs git in `cwd` and returns its stdout. */
export const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });

/** One file the change touches: git's status letter and its path. */
export type Touched = { readonly status: string; readonly path: string };

/** What HEAD holds above the refs: the commit it starts from and its files. */
export type Change = {
  readonly base: string;
  readonly files: readonly Touched[];
};

/** A path from git that stays inside the worktree. */
export const inside = (file: string): string => {
  if (path.isAbsolute(file) || file.split("/").includes("..")) {
    throw new Error(`Refusing the path ${file}.`);
  }
  return file;
};

/**
 * The commits of HEAD that none of `refs` holds, as the commit before the
 * oldest of them and the files they change; undefined when there are none.
 */
export const changeOf = (
  cwd: string,
  refs: readonly string[],
): Change | undefined => {
  const commits = git(cwd, [
    "rev-list",
    "--first-parent",
    "HEAD",
    "--not",
    ...refs,
  ])
    .split("\n")
    .filter(line => line !== "");
  const oldest = commits.at(-1);
  if (oldest === undefined) {
    return undefined;
  }
  const base = git(cwd, ["rev-parse", `${oldest}^`]).trim();
  const tokens = git(cwd, [
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    base,
    "HEAD",
  ])
    .split("\0")
    .filter(token => token !== "");
  const files: Touched[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    files.push({ status: tokens[i] ?? "", path: tokens[i + 1] ?? "" });
  }
  return { base, files };
};

/** A hunk header of a `-U0` diff: the first new line and the count. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;

/** The line numbers (from 1) of `file` in HEAD that the change adds. */
export const addedLines = (
  cwd: string,
  base: string,
  file: string,
): Set<number> => {
  const lines = new Set<number>();
  const diff = git(cwd, [
    "diff",
    "-U0",
    "--no-renames",
    "--no-color",
    base,
    "HEAD",
    "--",
    file,
  ]);
  for (const line of diff.split("\n")) {
    const match = HUNK.exec(line);
    const start = Number(match?.[1] ?? 0);
    const count = match === null ? 0 : Number(match[2] ?? 1);
    for (let n = 0; n < count; n += 1) {
      lines.add(start + n);
    }
  }
  return lines;
};

/** The paths under `dir` in the tree of `ref`. */
export const treeFiles = (cwd: string, ref: string, dir: string): string[] =>
  git(cwd, [
    "ls-tree",
    "-r",
    "--name-only",
    "--full-name",
    "-z",
    ref,
    "--",
    dir,
  ])
    .split("\0")
    .filter(name => name !== "");

/** The lines of `ref`'s files under `paths` matching the extended regex. */
export const grepLines = (
  cwd: string,
  ref: string,
  pattern: string,
  paths: readonly string[],
): string[] => {
  try {
    return git(cwd, [
      "grep",
      "-h",
      "-I",
      "--no-color",
      "-E",
      "-e",
      pattern,
      ref,
      "--",
      ...paths,
    ])
      .split("\n")
      .filter(line => line !== "");
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if (error instanceof Error && "status" in error && error.status === 1) {
      return [];
    }
    throw error;
  }
};

/** `file` at `ref`, or undefined when the ref has no such file. */
export const showFile = (
  cwd: string,
  ref: string,
  file: string,
): string | undefined => {
  try {
    return git(cwd, ["show", `${ref}:${file}`]);
  } catch {
    return undefined;
  }
};
