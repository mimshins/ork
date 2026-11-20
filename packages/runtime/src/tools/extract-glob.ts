/**
 * @file The glob rule of the `extract` tool's `files` and `search` steps: a
 *   glob with a `/` is matched against the whole path from the session's
 *   folder, and one without a `/` against the name at any depth, as models mean
 *   `*.ts`.
 */

import path from "node:path";

/** Whether `file` (relative to the folder, `/`-separated) matches `glob`. */
export const matchesGlob = (file: string, glob: string): boolean =>
  path.posix.matchesGlob(file, glob.includes("/") ? glob : `**/${glob}`);
