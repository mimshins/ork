/**
 * @file Fixtures for runs against a remote `git.base`: a project folder with
 *   one workflow (a committed repository, or not), a bare `origin` beside it,
 *   and that origin cut off so any fetch fails.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/**
 * A folder with `text` as `<file>`; a committed repository when `git` is set.
 */
export const projectWith = (
  text: string,
  git: boolean,
  file = "scout.ork.yaml",
): string => {
  const dir = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-read-"))),
    "app",
  );
  mkdirSync(dir);
  writeFileSync(path.join(dir, file), text);
  writeFileSync(path.join(dir, "CLAUDE.md"), "# App\n");
  writeFileSync(path.join(dir, ".gitignore"), ".ork/runs/\n");
  const steps = git
    ? [
        ["init", "-q", "-b", "main"],
        ["config", "user.email", "dev@example.com"],
        ["config", "user.name", "Dev"],
        ["add", "-A"],
        ["commit", "-q", "-m", "init"],
      ]
    : [];
  for (const args of steps) sh(dir, ...args);
  return dir;
};

/** The repository with a bare `origin` beside it, fetched. */
export const withOrigin = (dir: string): void => {
  const remote = path.join(path.dirname(dir), "remote.git");
  sh(dir, "clone", "-q", "--bare", dir, remote);
  sh(dir, "remote", "add", "origin", remote);
  sh(dir, "fetch", "-q", "origin");
};

/** `origin` from now on points nowhere: any fetch fails. */
export const cutOff = (dir: string): void => {
  sh(dir, "remote", "set-url", "origin", "/nowhere/missing.git");
};

/** The repository with an `origin` it fetched once, then can't reach. */
export const unreachableOrigin = (dir: string): void => {
  withOrigin(dir);
  cutOff(dir);
};
