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
