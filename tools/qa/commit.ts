/**
 * @file `kit.ts commit <repo> [message]`: commits everything in a throwaway
 *   repo with the kit's fixed identity, for a later commit a QA surface needs
 *   (the project denies `Bash(git commit *)` to every node). It is bounded: it
 *   refuses unless the repo's top level and its common git folder are both
 *   inside a kit root under the temp folder, and it refuses anything in this
 *   project's checkout or its worktrees (they share one common git folder).
 *   Every check is on realpaths.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

import { isInside, kitRootOf, tmpPath } from "./roots.ts";
import { kitGit } from "./setup.ts";

/** This project's checkout, from the kit's own place (`tools/qa/`). */
const PROJECT_ROOT = realpathSync(path.resolve(import.meta.dirname, "../.."));

/** The realpath of a repo's common git folder, from `cwd`. */
const commonDirOf = (cwd: string): string =>
  realpathSync(
    path.resolve(cwd, kitGit(cwd, ["rev-parse", "--git-common-dir"]).trim()),
  );

/** This project's common git folder, or `undefined` outside a git checkout. */
const projectCommonDir = (): string | undefined => {
  try {
    return commonDirOf(PROJECT_ROOT);
  } catch {
    return undefined;
  }
};

/**
 * Commits everything in `repo`.
 *
 * @returns The new commit's short id and the repo's top level.
 * @throws When `repo` is this project's, or is not a repo inside a kit root.
 */
export const commitAll = (
  repo: string,
  message = "QA commit",
  projectCommon: string | undefined = projectCommonDir(),
): string => {
  const cwd = tmpPath(path.resolve(repo));
  let top: string;
  let common: string;
  try {
    top = realpathSync(kitGit(cwd, ["rev-parse", "--show-toplevel"]).trim());
    common = commonDirOf(cwd);
  } catch {
    throw new Error(`${cwd} is not a git repository.`);
  }
  if (
    top === PROJECT_ROOT ||
    isInside(top, PROJECT_ROOT) ||
    common === projectCommon
  ) {
    throw new Error(
      `${top} belongs to this project; the kit will not commit there.`,
    );
  }
  if (kitRootOf(top) === undefined || kitRootOf(common) === undefined) {
    throw new Error(
      `${top} (git folder ${common}) is not inside a QA kit root under the temp folder.`,
    );
  }
  kitGit(top, ["add", "-A"]);
  kitGit(top, ["commit", "--quiet", "--allow-empty", "-m", message]);
  return `Committed ${kitGit(top, ["rev-parse", "--short", "HEAD"]).trim()} in ${top}`;
};
