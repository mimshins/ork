/**
 * @file The `extract` steps RFC-025 added so a session never needs Glob or a
 *   shell pipeline: the `files` producer (the folder's files, tracked and
 *   untracked but not ignored, by `git ls-files`, filtered by a glob in Ork's
 *   process) and the `regex` form of `match`, run by `git grep --no-index -E`
 *   on the text in a temporary file, so a pattern the model wrote never runs in
 *   Ork's own regular-expression engine and is bounded by git's timeout.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type Denied, readable } from "./contain.ts";
import { linesOf, runGit } from "./extract-git.ts";
import { matchesGlob } from "./extract-glob.ts";

export type FilesStep = {
  step: "files";
  /** A folder; default `.`. */
  path?: string;
  /**
   * With a `/`, matched against the whole path relative to the folder (`**`
   * crosses folders); without one, against the name at any depth.
   */
  glob?: string;
  max?: number;
};

export const DEFAULT_FILES = 200;
export const MAX_FILES = 1000;

/** The folder's files, one a line, sorted by path. */
export const filesStep = async (
  cwd: string,
  step: FilesStep,
  denied: Denied,
): Promise<string> => {
  const where = readable(cwd, step.path ?? ".", denied).rel;
  const result = await runGit(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--deduplicate",
    "--",
    where,
  ]);
  const { glob } = step;
  const files = result.out
    .split("\0")
    .filter(file => file !== "" && !denied(file))
    .filter(file => glob === undefined || matchesGlob(file, glob))
    .toSorted();
  const max = Math.min(step.max ?? DEFAULT_FILES, MAX_FILES);
  const more = files.length - max;
  return [
    ...(files.length === 0 ? ["[no files]"] : files.slice(0, max)),
    ...(more > 0 ? [`[${more} more files: narrow the glob or path]`] : []),
    ...(result.cut ? ["[git output cut at 1 MiB]"] : []),
  ].join("\n");
};

/**
 * The lines of `text` matching the POSIX extended regular expression `pattern`,
 * with `context` lines around and `--` between runs.
 */
export const regexLines = async (
  text: string,
  pattern: string,
  options: { ignoreCase?: boolean; context?: number },
): Promise<string> => {
  if (text === "") return "";
  const dir = mkdtempSync(path.join(tmpdir(), "ork-extract-"));
  try {
    writeFileSync(path.join(dir, "text"), `${text}\n`);
    const context = Math.max(options.context ?? 0, 0);
    const result = await runGit(dir, [
      "grep",
      "--no-index",
      "--no-color",
      "-h",
      "-a",
      "-E",
      ...(options.ignoreCase === true ? ["-i"] : []),
      ...(context > 0 ? ["-C", String(context)] : []),
      "-e",
      pattern,
      "--",
      "text",
    ]);
    return linesOf(result.out).join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
