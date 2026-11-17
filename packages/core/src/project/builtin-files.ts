/**
 * @file Ork's built-in workflows by their `ork:` names. Everything that runs a
 *   workflow reads it from a file, and a resumed run reads the same file again,
 *   so a built-in is written into the project's gitignored run folder, under
 *   its content's hash: `.ork/runs/.builtin/<hash>/<name>.ork.yaml`. The file
 *   is in the project, so the run belongs to it, and a run started before Ork
 *   changed a built-in resumes from the text it started with. A built-in can be
 *   a bundle: companion files (`builtin-bundles.ts`) written beside the
 *   workflow, under one hash of them all (ADR-059, extended by ADR-096).
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { BUILTIN_FILES } from "./builtin-bundles.ts";
import { BUILTIN_WORKFLOWS } from "./builtin-workflows.ts";
import {
  inRepoPlace,
  ORK_DIR,
  placeFiles,
  type ProjectPlace,
} from "./place.ts";
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

/** The text of the built-in `arg` names (`ork:<name>`), without writing it. */
export const builtinWorkflowText = (arg: string): string | undefined =>
  isBuiltinArg(arg) ? textOf(arg.slice(BUILTIN_PREFIX.length)) : undefined;

/** Why an `ork:` argument names no built-in, or `undefined` when it does. */
export const unknownBuiltin = (arg: string): string | undefined =>
  isBuiltinArg(arg) && textOf(arg.slice(BUILTIN_PREFIX.length)) === undefined
    ? `\`${arg}\` isn't one of Ork's workflows: ${builtinWorkflowNames()
        .map(name => `\`${name}\``)
        .join(", ")}`
    : undefined;

/**
 * What a built-in's texts carry for its bundle's folder, relative to the
 * project root (`.ork/runs/.builtin/<hash>`); replaced when they are written.
 */
export const BUNDLE_DIR_PLACEHOLDER = "__ORK_BUNDLE_DIR__";

/** One file of a written bundle: where it goes, and its text there. */
type BundleFile = { file: string; text: string };

/**
 * The hash of a built-in's whole bundle, taken before the placeholder is
 * replaced; a built-in with no companions hashes its workflow text alone.
 */
const bundleHash = (
  workflow: string,
  files: Readonly<Record<string, string>>,
): string => {
  const hash = createHash("sha256").update(workflow);
  for (const [file, text] of Object.entries(files).toSorted(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    hash.update(JSON.stringify([file, text]));
  }
  return hash.digest("hex").slice(0, 12);
};

/**
 * The files the built-in `arg` names writes in `place`, the workflow first,
 * written or not; `undefined` for an unknown name.
 */
const bundleFiles = (
  place: ProjectPlace,
  arg: string,
): { folder: string; files: BundleFile[] } | undefined => {
  const name = arg.slice(BUILTIN_PREFIX.length);
  const workflow = textOf(name);
  if (!isBuiltinArg(arg) || workflow === undefined) return undefined;
  const companions =
    (Object.hasOwn(BUILTIN_FILES, name) ? BUILTIN_FILES[name] : undefined) ??
    {};
  const folder = path.join(
    placeFiles(place).runs,
    ".builtin",
    bundleHash(workflow, companions),
  );
  // The same text in every place, so a copy written into a run worktree
  // (`builtinBundleUnder`) is byte-identical to the one under `~/.ork`.
  const shown = `${ORK_DIR}/runs/.builtin/${path.basename(folder)}`;
  const fill = (text: string): string =>
    text.replaceAll(BUNDLE_DIR_PLACEHOLDER, shown);
  return {
    folder,
    files: [
      { file: path.join(folder, `${name}.ork.yaml`), text: fill(workflow) },
      ...Object.entries(companions).map(([file, text]) => ({
        file: path.join(folder, file),
        text: fill(text),
      })),
    ],
  };
};

/**
 * The first file of the bundle `arg` names whose path has a link on it (or
 * leaves the bundle's folder), or `undefined` when every path is plain.
 */
const linkedFile = (place: ProjectPlace, arg: string): string | undefined => {
  const bundle = bundleFiles(place, arg);
  if (bundle === undefined) return undefined;
  const base = guardedBase(place);
  return bundle.files.find(
    ({ file }) =>
      !plainPathInside(base, file) || !plainPathInside(bundle.folder, file),
  )?.file;
};

/** Whether something other than a plain file (a folder, say) is at `file`. */
const isNonFile = (file: string): boolean => {
  try {
    return !lstatSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * The first file of the bundle `arg` names whose path holds a folder (or other
 * non-file); checked after `linkedFile`, so a link never reaches it.
 */
const folderAtFile = (place: ProjectPlace, arg: string): string | undefined =>
  bundleFiles(place, arg)?.files.find(({ file }) => isNonFile(file))?.file;

/**
 * Why `arg` can't be run in `place`: no such built-in, or one of its files'
 * place is a link a cloned repository could aim at the person's own files, or a
 * folder (never removed).
 */
export const builtinProblem = (
  place: ProjectPlace,
  arg: string,
): string | undefined => {
  const unknown = unknownBuiltin(arg);
  if (unknown !== undefined) return unknown;
  const linked = linkedFile(place, arg);
  if (linked !== undefined) {
    return `\`${path.relative(place.root, linked)}\` is a link, or behind one: Ork writes its own workflows only to plain files in the project, so it wrote nothing.`;
  }
  const folder = folderAtFile(place, arg);
  return folder === undefined
    ? undefined
    : `\`${path.relative(place.root, folder)}\` is a folder, not a file: Ork writes its own workflow there, so it wrote nothing.`;
};

/**
 * The file of the built-in `arg` names (`ork:<name>`) in `place`'s run folder,
 * with its companion files beside it, each written when it isn't there as it
 * should be, by a rename that never follows a link; `undefined` for an unknown
 * name, or when any file's path has a link or a folder on it (then nothing is
 * written, and nothing is removed).
 */
export const builtinWorkflowFile = (
  place: ProjectPlace,
  arg: string,
): string | undefined => {
  const bundle = bundleFiles(place, arg);
  if (
    bundle === undefined ||
    linkedFile(place, arg) !== undefined ||
    folderAtFile(place, arg) !== undefined
  ) {
    return undefined;
  }
  const base = guardedBase(place);
  for (const { file, text } of bundle.files) {
    if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
    if (!writePlainFile(base, file, text).ok) return undefined;
  }
  return bundle.files[0]?.file;
};

/**
 * Writes the built-in `arg` names under `root` as an in-repo project would hold
 * it (`<root>/.ork/runs/.builtin/<hash>/`), for a run worktree that is every
 * node's working root; the same files, hash and link guard as
 * `builtinWorkflowFile`. Returns the workflow's file, or why nothing was
 * written (a link on a path or at `root`, a folder at a file, an unknown
 * name).
 */
export const builtinBundleUnder = (
  root: string,
  arg: string,
): { ok: true; file: string } | { ok: false; error: string } => {
  const place = inRepoPlace(root);
  const problem = lstatSync(root).isSymbolicLink()
    ? `\`${root}\` is a link: Ork writes its own workflow only to plain folders, so it wrote nothing.`
    : builtinProblem(place, arg);
  if (problem !== undefined) return { ok: false, error: problem };
  const file = builtinWorkflowFile(place, arg);
  return file === undefined
    ? { ok: false, error: `Ork could not write \`${arg}\` under \`${root}\`.` }
    : { ok: true, file };
};
