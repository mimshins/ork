/**
 * @file Finding workflow files: `.ork/workflows/*.ork.yaml` by default,
 *   directories expanded, and a workflow given by name.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const WORKFLOW_DIR = path.join(".ork", "workflows");
export const WORKFLOW_SUFFIX = ".ork.yaml";

/**
 * Expands the given paths to workflow files: a directory contributes its
 * `*.ork.yaml` files. With no paths, uses `.ork/workflows/` under `cwd`.
 */
export const findWorkflowFiles = (
  paths: readonly string[],
  cwd: string,
): string[] => {
  const targets = paths.length > 0 ? paths : [WORKFLOW_DIR];
  return targets.flatMap(target => {
    const absolute = path.resolve(cwd, target);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return readdirSync(absolute)
        .filter(name => name.endsWith(WORKFLOW_SUFFIX))
        .toSorted()
        .map(name => path.join(target, name));
    }
    return [target];
  });
};

/**
 * A workflow given by path, or by name for one in `.ork/workflows/`: `hello` is
 * `.ork/workflows/hello.ork.yaml` when no file `hello` exists.
 */
export const resolveWorkflowArg = (arg: string, cwd: string): string => {
  if (existsSync(path.resolve(cwd, arg)) || arg.endsWith(WORKFLOW_SUFFIX)) {
    return arg;
  }
  const named = path.join(WORKFLOW_DIR, `${arg}${WORKFLOW_SUFFIX}`);
  return existsSync(path.resolve(cwd, named)) ? named : arg;
};
