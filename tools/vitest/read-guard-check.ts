/**
 * @file Fails a test run that read a file the tests' `ork once --on` list
 *   leaves out (`check:all` in `package.json`), so an edit there can't skip a
 *   test that depends on it (L374 closed). A Vitest global setup: its teardown
 *   reads what `tools/vitest/read-guard.ts` logged and asks git which of those
 *   files the pathspecs match. A folder counts when every file in it is left
 *   out; a path that doesn't exist is not checked.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The `--on` pathspecs of the `tests` step in a `check:all` script. */
export const testsPathspecs = (checkAll: string): string[] => {
  const step = /--as tests (.*?) -- /u.exec(checkAll)?.[1] ?? "";
  return [...step.matchAll(/--on (?:'([^']*)'|(\S+))/gu)].map(
    ([, quoted, plain]) => quoted ?? plain ?? "",
  );
};

/** `check:all` in a `package.json`'s text, if it has one. */
export const checkAllOf = (manifest: string): string | undefined => {
  const parsed: unknown = JSON.parse(manifest);
  const scripts: unknown =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "scripts")
      : undefined;
  const checkAll: unknown =
    typeof scripts === "object" && scripts !== null
      ? Reflect.get(scripts, "check:all")
      : undefined;
  return typeof checkAll === "string" ? checkAll : undefined;
};

/** The repository's files (tracked, and untracked not ignored) git lists. */
const listed = (pathspecs: readonly string[]): Set<string> => {
  const done = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...pathspecs,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (done.status !== 0) throw new Error(`git ls-files: ${done.stderr}`);
  return new Set(done.stdout.split("\0").filter(file => file !== ""));
};

/**
 * Of `reads` (paths from the root), those the pathspecs leave out: a file among
 * `all` but not `kept`, or a folder whose files are all left out.
 */
export const leftOut = (
  reads: Iterable<string>,
  all: ReadonlySet<string>,
  kept: ReadonlySet<string>,
): string[] =>
  [...new Set(reads)]
    .filter(read => {
      if (all.has(read)) return !kept.has(read);
      const inside = [...all].filter(file => file.startsWith(`${read}/`));
      return inside.length > 0 && inside.every(file => !kept.has(file));
    })
    .toSorted();

/** What the run's tests read, from every worker's log. */
const logged = (log: string): string[] =>
  existsSync(log)
    ? readdirSync(log).flatMap(file =>
        readFileSync(path.join(log, file), "utf8")
          .split("\n")
          .filter(line => line !== ""),
      )
    : [];

export default () => () => {
  const log = process.env["ORK_TEST_READ_LOG"];
  if (log === undefined) return;
  const reads = logged(log);
  if (reads.length === 0) return;
  const checkAll = checkAllOf(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  if (checkAll === undefined) return;
  const bad = leftOut(reads, listed([]), listed(testsPathspecs(checkAll)));
  if (bad.length > 0) {
    throw new Error(
      `Tests read files the tests' --on list in package.json's check:all leaves out, so an edit there would skip them: ${bad.join(", ")}. Take the path out of the exclude list, or stop reading it.`,
    );
  }
};
