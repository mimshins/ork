/**
 * @file The checks every destructive kit command makes first: a path counts
 *   only when its realpath is under the realpath of `os.tmpdir()` and, for a
 *   root, holds the `.ork-qa-root` marker. All comparisons are on realpaths, so
 *   a symlink or `..` cannot lead one outside the temp folder.
 */

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isKitRoot } from "./setup.ts";

/** Whether `child` is strictly inside `parent` (both realpaths). */
export const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

/** The realpath of the temp folder. */
export const realTmp = (): string => realpathSync(tmpdir());

/**
 * The realpath of `dir`, which must be absolute, exist and sit strictly under
 * the temp folder.
 *
 * @throws When it does not.
 */
export const tmpPath = (dir: string): string => {
  if (!path.isAbsolute(dir)) {
    throw new Error(`${dir} is not an absolute path.`);
  }
  const real = realpathSync(dir);
  if (!isInside(real, realTmp())) {
    throw new Error(`${real} is not inside the temp folder (${realTmp()}).`);
  }
  return real;
};

/**
 * The nearest kit root at or above `dir` (a realpath under the temp folder), or
 * `undefined` when none holds the marker below the temp folder.
 */
export const kitRootOf = (dir: string): string | undefined => {
  const tmp = realTmp();
  let current = dir;
  while (isInside(current, tmp)) {
    if (isKitRoot(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
};

/**
 * The realpath of `root`, which must be an absolute path to a kit root under
 * the temp folder.
 *
 * @throws When it is not one.
 */
export const kitRoot = (root: string): string => {
  const real = tmpPath(root);
  if (!isKitRoot(real)) {
    throw new Error(`${real} is not a QA kit root (no marker file).`);
  }
  return real;
};
