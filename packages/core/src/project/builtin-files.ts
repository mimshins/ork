/**
 * @file Ork's built-in workflows by their `ork:` names. Everything that runs a
 *   workflow reads it from a file, and a resumed run reads the same file again,
 *   so a built-in is written into the project's gitignored run folder, under
 *   its content's hash: `.ork/runs/.builtin/<hash>/<name>.ork.yaml`. The file
 *   is in the project, so the run belongs to it, and a run started before Ork
 *   changed a built-in resumes from the text it started with.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BUILTIN_WORKFLOWS } from "./builtin-workflows.ts";
import { placeFiles, type ProjectPlace } from "./place.ts";

/** What marks a workflow argument as one of Ork's own: `ork:feedback-apply`. */
export const BUILTIN_PREFIX = "ork:";

export const isBuiltinArg = (arg: string): boolean =>
  arg.startsWith(BUILTIN_PREFIX);

/** The built-ins' `ork:` names, in name order. */
export const builtinWorkflowNames = (): string[] =>
  Object.keys(BUILTIN_WORKFLOWS)
    .toSorted()
    .map(name => `${BUILTIN_PREFIX}${name}`);

/** Why an `ork:` argument names no built-in, or `undefined` when it does. */
export const unknownBuiltin = (arg: string): string | undefined =>
  isBuiltinArg(arg) &&
  BUILTIN_WORKFLOWS[arg.slice(BUILTIN_PREFIX.length)] === undefined
    ? `\`${arg}\` isn't one of Ork's workflows: ${builtinWorkflowNames()
        .map(name => `\`${name}\``)
        .join(", ")}`
    : undefined;

/**
 * The file of the built-in `arg` names (`ork:<name>`) in `place`'s run folder,
 * written when it isn't there yet; `undefined` for an unknown name.
 */
export const builtinWorkflowFile = (
  place: ProjectPlace,
  arg: string,
): string | undefined => {
  const name = arg.slice(BUILTIN_PREFIX.length);
  const text = BUILTIN_WORKFLOWS[name];
  if (!isBuiltinArg(arg) || text === undefined) return undefined;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  const folder = path.join(placeFiles(place).runs, ".builtin", hash);
  const file = path.join(folder, `${name}.ork.yaml`);
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, text);
  }
  return file;
};
