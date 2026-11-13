/**
 * @file Finding workflow files: the project's workflows folder by default
 *   (`.ork/workflows/`, or an attached project's), directories expanded, a
 *   workflow given by name, and one of Ork's own by its `ork:` name, written
 *   into the project's run folder.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  builtinWorkflowFile,
  isBuiltinArg,
  placeFiles,
  type ProjectPlace,
  builtinProblem,
  runDirOf,
} from "@krapht/ork-core";

import { writeErr } from "./output.ts";
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
  // No folder yet (no `ork init`): nothing to find, which the command says.
  if (paths.length === 0 && !existsSync(workflows)) return [];
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
 * A workflow given by path, by name for one in the project's workflows folder
 * (`hello` is `.ork/workflows/hello.ork.yaml` when no file `hello` exists), or
 * by its `ork:` name for one of Ork's own. An unknown `ork:` name comes back as
 * it is: commands refuse it first (`unknownBuiltin`).
 */
export const resolveWorkflowArg = (
  arg: string,
  cwd: string,
  workflows: string = path.join(cwd, WORKFLOW_DIR),
): string => {
  if (isBuiltinArg(arg)) {
    const file = builtinWorkflowFile(projectAt(cwd), arg);
    return file === undefined ? arg : fromCwd(file, cwd);
  }
  if (existsSync(path.resolve(cwd, arg)) || arg.endsWith(WORKFLOW_SUFFIX)) {
    return arg;
  }
  const named = path.join(workflows, `${arg}${WORKFLOW_SUFFIX}`);
  return existsSync(named) ? fromCwd(named, cwd) : arg;
};

/**
 * Refuses an `ork:` name that isn't one of Ork's workflows, saying which are,
 * or whose file's place in the project is a link; true when it did, so the
 * command stops.
 */
export const refusedBuiltin = (
  args: readonly string[],
  cwd: string,
): boolean => {
  const problems = args
    .filter(arg => isBuiltinArg(arg))
    .flatMap(arg => builtinProblem(projectAt(cwd), arg) ?? []);
  for (const problem of problems) writeErr(problem);
  if (problems.length > 0) process.exitCode = 1;
  return problems.length > 0;
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

/**
 * The `name:` line of a workflow file, read without parsing it (it may be
 * broken).
 */
const nameOf = (file: string): string | undefined => {
  try {
    return /^name:\s*["']?([^\s"'#]+)/mu.exec(readFileSync(file, "utf8"))?.[1];
  } catch {
    return undefined;
  }
};

/**
 * The text for a workflow argument that is no file: the workflows the project
 * has, by file name (and `name:` when it differs), and that a file name or path
 * is what the command takes. Empty-handed when the folder is missing.
 */
export const missingWorkflowText = (arg: string, workflows: string): string => {
  const files = existsSync(workflows)
    ? readdirSync(workflows)
        .filter(name => name.endsWith(WORKFLOW_SUFFIX))
        .toSorted()
    : [];
  const listed = files.map(file => {
    const name = nameOf(path.join(workflows, file));
    const stem = file.slice(0, -WORKFLOW_SUFFIX.length);
    return name === undefined || name === stem ? file : `${file} (${name})`;
  });
  const have =
    listed.length === 0
      ? "this project has no workflows"
      : `this project's workflows: ${listed.join(", ")}`;
  return `no workflow file ${arg}; a file name or path is meant, not a workflow name (${have})`;
};
