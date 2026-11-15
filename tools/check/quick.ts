/**
 * @file `pnpm check:quick`: the loop between edits. Runs `oxfmt --check` and
 *   `oxlint` on the files changed since `HEAD` (and untracked ones) only, then
 *   the two typechecks. It skips the docs, map and benchmarks checks and never
 *   records an `ork once` pass, so it can pass what `pnpm check:fast` fails.
 */

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/** Paths git prints with `-z`, split on NUL. */
const lines = (out: string): string[] => out.split("\0").filter(f => f !== "");

/**
 * The files to check under `cwd`: changed since `HEAD` (renames count as the
 * new name, deleted files are left out) and untracked ones, each once.
 */
export const changedFiles = (cwd: string): string[] => {
  const git = (...args: string[]): string[] =>
    lines(execFileSync("git", args, { cwd, encoding: "utf8" }));
  return [
    ...new Set([
      ...git("diff", "--name-only", "-z", "--diff-filter=d", "HEAD"),
      ...git("ls-files", "-z", "--others", "--exclude-standard"),
    ]),
  ];
};

/** The workspace's own tool, so no `pnpm exec` start. */
const tool = (cwd: string, bin: string): string =>
  path.join(cwd, "node_modules/.bin", bin);

/**
 * Runs `bin args` from `cwd`; the exit code of the tool, 1 when it did not
 * start.
 */
const run = (cwd: string, bin: string, args: string[]): number =>
  spawnSync(tool(cwd, bin), args, { cwd, stdio: "inherit" }).status ?? 1;

/** Oxlint exits 1 with this line when every given path is ignored (`*.md`). */
const NO_FILES = "No files found to lint";

const lint = (cwd: string, files: string[]): number => {
  const result = spawnSync(tool(cwd, "oxlint"), ["--", ...files], {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
  process.stdout.write(result.stdout);
  return result.stdout.includes(NO_FILES) ? 0 : (result.status ?? 1);
};

const main = (): number => {
  const cwd = path.resolve(import.meta.dirname, "../..");
  const files = changedFiles(cwd);
  // With no file, oxfmt and oxlint would check the whole tree.
  const statuses =
    files.length === 0
      ? []
      : [
          run(cwd, "oxfmt", [
            "--check",
            "--no-error-on-unmatched-pattern",
            "--",
            ...files,
          ]),
          lint(cwd, files),
        ];
  const typecheck = [
    run(cwd, "tsc", ["-p", "tsconfig.json"]),
    run(cwd, "tsc", ["-p", "packages/ui"]),
  ];
  return [...statuses, ...typecheck].every(s => s === 0) ? 0 : 1;
};

if (import.meta.main) process.exitCode = main();
