/**
 * @file The `search` producer of the `extract` tool (RFC-023): `git grep -E`,
 *   or `-F` for fixed text, run by the git runner of `extract-git.ts`. It takes
 *   what models send: one path or several separated by whitespace (each must
 *   exist; a missing one is the call's mistake), a glob filtering the files
 *   hit, context lines with `--` between runs, and `max` for `maxMatches`. A
 *   pattern follows `-e` and the paths follow `--`; a denied file's lines,
 *   context included, are dropped.
 */

import { existsSync } from "node:fs";

import { type Denied, readable } from "./contain.ts";
import { badStep } from "./extract-error.ts";
import { linesOf, runGit } from "./extract-git.ts";
import { matchesGlob } from "./extract-glob.ts";

export type SearchStep = {
  step: "search";
  /**
   * POSIX extended regular expression (`git grep -E`); fixed text with `regex:
   * false`.
   */
  pattern: string;
  /** A file or folder, or several separated by whitespace. */
  path?: string;
  /** A file filter (`extract-glob.ts`). */
  glob?: string;
  /** Lines around each hit. */
  context?: number;
  regex?: boolean;
  ignoreCase?: boolean;
  maxMatches?: number;
  /** Same as `maxMatches`, which wins. */
  max?: number;
};

export const DEFAULT_MATCHES = 50;
export const MAX_MATCHES = 200;

/** `asked` as an existing path for git (contained, not denied), or a refusal. */
const existingPath = (cwd: string, asked: string, denied: Denied): string => {
  const where = readable(cwd, asked, denied);
  if (!existsSync(where.real))
    throw badStep(`no such file or folder: ${asked}`);
  return where.rel;
};

/**
 * A search's paths: the whole string when it is an existing path (even with a
 * space), else each whitespace-separated part, every one existing.
 */
const searchPaths = (cwd: string, asked: string, denied: Denied): string[] => {
  const parts = asked.split(/\s+/u).filter(part => part !== "");
  try {
    return [existingPath(cwd, asked, denied)];
  } catch (error) {
    // Nothing to split: the whole string's refusal stands.
    if (parts.length === 0 || (parts.length === 1 && parts[0] === asked)) {
      throw error;
    }
    // Not one path: each part is checked on its own.
    return parts.map(part => existingPath(cwd, part, denied));
  }
};

type Hit = { file: string; no: number; text: string };

/** Hits as `file:line: text`; with context, `--` between runs not adjacent. */
const hitLines = (hits: readonly Hit[], gaps: boolean): string[] =>
  hits.flatMap((hit, index) => {
    const before = hits[index - 1];
    const gap =
      gaps &&
      before !== undefined &&
      (before.file !== hit.file || before.no + 1 !== hit.no);
    const line = `${hit.file}:${String(hit.no)}: ${hit.text}`;
    return gap ? ["--", line] : [line];
  });

export const searchStep = async (
  cwd: string,
  step: SearchStep,
  denied: Denied,
): Promise<string> => {
  const where = searchPaths(cwd, step.path ?? ".", denied);
  const context = step.context ?? 0;
  const result = await runGit(cwd, [
    "grep",
    step.regex === false ? "-F" : "-E",
    "-n",
    "-I",
    "--null",
    "--untracked",
    // A `color.*` setting would wrap names in escapes the deny check can't read.
    "--no-color",
    ...(step.ignoreCase === true ? ["-i"] : []),
    ...(context > 0 ? ["-C", String(context)] : []),
    "-e",
    step.pattern,
    "--",
    ...where,
  ]);
  const { glob } = step;
  // `path\0line\0text`, context lines alike (`--null` marks them the same);
  // git's `--` lines and a line cut short by the cap have fewer parts. Denied
  // files go before the gaps are rebuilt, so none leaves a stray `--`.
  // shortcut: the glob filters after git's 1 MiB cap, so on a huge tree it can
  // miss hits; upgrade by passing the matching files as pathspecs.
  const hits = linesOf(result.out)
    .map(line => line.split("\0"))
    .filter(parts => parts.length >= 3)
    .map(([file = "", no = "", ...text]) => ({
      file,
      no: Number(no),
      text: text.join("\0"),
    }))
    .filter(hit => !denied(hit.file))
    .filter(hit => glob === undefined || matchesGlob(hit.file, glob));
  const max = Math.min(
    step.maxMatches ?? step.max ?? DEFAULT_MATCHES,
    MAX_MATCHES,
  );
  const more = hits.length - max;
  const what = context > 0 ? "lines" : "matches";
  return [
    ...(hits.length === 0
      ? ["[no matches]"]
      : hitLines(hits.slice(0, max), context > 0)),
    ...(more > 0 ? [`[${more} more ${what}: narrow the pattern or path]`] : []),
    ...(result.cut ? ["[git output cut at 1 MiB]"] : []),
  ].join("\n");
};
