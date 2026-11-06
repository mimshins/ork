/**
 * @file Ork's built-in workflows by their `ork:` names. Everything that runs a
 *   workflow reads it from a file, and a resumed run reads the same file again,
 *   so a built-in is written into the project's gitignored run folder, under
 *   its content's hash: `.ork/runs/.builtin/<hash>/<name>.ork.yaml`. The file
 *   is in the project, so the run belongs to it, and a run started before Ork
 *   changed a built-in resumes from the text it started with.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BUILTIN_WORKFLOWS } from "./builtin-workflows.ts";
import { placeFiles, type ProjectPlace } from "./place.ts";
import { guardedBase, plainPathInside, writePlainFile } from "./plain-files.ts";

/** A built-in's text by its bare name; never one of an object's own keys. */
const textOf = (name: string): string | undefined =>
  Object.hasOwn(BUILTIN_WORKFLOWS, name) ? BUILTIN_WORKFLOWS[name] : undefined;

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
  isBuiltinArg(arg) && textOf(arg.slice(BUILTIN_PREFIX.length)) === undefined
    ? `\`${arg}\` isn't one of Ork's workflows: ${builtinWorkflowNames()
        .map(name => `\`${name}\``)
        .join(", ")}`
    : undefined;

/** Where the built-in `arg` names goes in `place`, written or not. */
const builtinPath = (place: ProjectPlace, arg: string): string | undefined => {
  const name = arg.slice(BUILTIN_PREFIX.length);
  const text = textOf(name);
  if (!isBuiltinArg(arg) || text === undefined) return undefined;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return path.join(
    placeFiles(place).runs,
    ".builtin",
    hash,
    `${name}.ork.yaml`,
  );
};

/**
 * Why `arg` can't be run in `place`: no such built-in, or its file's place is a
 * link a cloned repository could aim at the person's own files.
 */
export const builtinProblem = (
  place: ProjectPlace,
  arg: string,
): string | undefined => {
  const unknown = unknownBuiltin(arg);
  if (unknown !== undefined) return unknown;
  const file = builtinPath(place, arg);
  return file === undefined || plainPathInside(guardedBase(place), file)
    ? undefined
    : `\`${path.relative(place.root, file)}\` is a link, or behind one: Ork writes its own workflows only to plain files in the project, so it wrote nothing.`;
};

/**
 * The file of the built-in `arg` names (`ork:<name>`) in `place`'s run folder,
 * written when it isn't there yet, by a rename that never follows a link;
 * `undefined` for an unknown name, or a path with a link on it.
 */
export const builtinWorkflowFile = (
  place: ProjectPlace,
  arg: string,
): string | undefined => {
  const file = builtinPath(place, arg);
  const text = textOf(arg.slice(BUILTIN_PREFIX.length));
  if (file === undefined || text === undefined) return undefined;
  const base = guardedBase(place);
  if (!plainPathInside(base, file)) return undefined;
  if (existsSync(file) && readFileSync(file, "utf8") === text) return file;
  return writePlainFile(base, file, text).ok ? file : undefined;
};
