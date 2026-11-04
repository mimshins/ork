/**
 * @file `$ORK_STATE` (RFC-011): a file a `watch:` node's program keeps between
 *   looks, rounds and a resume, so a script can tell what's new without
 *   inventing a place to keep it. It's the program's to create, and holds what
 *   the program wrote, so it's private, and goes when the run has succeeded.
 */

import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const STATE_FOLDER = ".state";

/** The file `$ORK_STATE` names, for one node in one run. */
export const prepareStateFile = (runDir: string, id: string): string => {
  const folder = path.join(runDir, STATE_FOLDER);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return path.join(folder, id);
};

/** Removes what programs kept, once the run can't go on from it. */
export const clearStateFiles = (
  runDir: string,
  warn: (line: string) => void,
): void => {
  const folder = path.join(runDir, STATE_FOLDER);
  try {
    rmSync(folder, { force: true, recursive: true });
  } catch {
    warn(`Could not remove ${folder}, which holds what a program kept.`);
  }
};
