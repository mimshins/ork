/**
 * @file Finding workflow files: the project's workflows folder by default
 *   (`.ork/workflows/`, or an attached project's), directories expanded, and a
 *   workflow given by name.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { placeFiles, type ProjectPlace, runDirOf } from "@krapht/ork-core";

import { fromCwd, projectAt } from "./project/place.ts";

export const WORKFLOW_DIR = path.join(".ork", "workflows");
export const WORKFLOW_SUFFIX = ".ork.yaml";

/**
 * Expands the given paths to workflow files: a directory contributes its
 * `*.ork.yaml` files, and a name one in the project's workflows folder
 * (`workflows`, default `.ork/workflows/` under `cwd`). With no paths, uses
 * that folder.
 */
export const findWorkflowFiles = (
  paths: readonly string[],
  cwd: string,
  workflows: string = path.join(cwd, WORKFLOW_DIR),
): string[] => {
  const targets = paths.length > 0 ? paths : [fromCwd(workflows, cwd)];
  return targets.flatMap(target => {
    const absolute = path.resolve(cwd, target);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return readdirSync(absolute)
        .filter(name => name.endsWith(WORKFLOW_SUFFIX))
        .toSorted()
        .map(name => path.join(target, name));
    }
    return [resolveWorkflowArg(target, cwd, workflows)];
  });
};

/**
 * A workflow given by path, or by name for one in the project's workflows
 * folder: `hello` is `.ork/workflows/hello.ork.yaml` when no file `hello`
 * exists.
 */
export const resolveWorkflowArg = (
  arg: string,
  cwd: string,
  workflows: string = path.join(cwd, WORKFLOW_DIR),
): string => {
  if (existsSync(path.resolve(cwd, arg)) || arg.endsWith(WORKFLOW_SUFFIX)) {
    return arg;
  }
  const named = path.join(workflows, `${arg}${WORKFLOW_SUFFIX}`);
  return existsSync(named) ? fromCwd(named, cwd) : arg;
};

/**
 * A command's workflow argument, by path or by name in the project `cwd` is in,
 * with the project the file belongs to and a run's folder there.
 */
export const workflowArg = (
  arg: string,
  cwd: string,
): { file: string; place: ProjectPlace; runDir: (runId: string) => string } => {
  const file = resolveWorkflowArg(
    arg,
    cwd,
    placeFiles(projectAt(cwd)).workflows,
  );
  const place = projectAt(path.dirname(path.resolve(cwd, file)));
  return { file, place, runDir: runId => runDirOf(place, runId) };
};
