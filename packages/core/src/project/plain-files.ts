/**
 * @file Writing Ork's own files into a project without following a link. A
 *   cloned repository can commit `.ork/lessons/<workflow>.md`, or a folder on
 *   the way to it, as a symlink to a file of the person's (`~/.profile`), so a
 *   write through it would land there. Ork writes only where every step from
 *   the project down to the file is a plain folder or file, and replaces a file
 *   by renaming a copy over it, which never writes through a link.
 */

import {
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ProjectPlace } from "./place.ts";

/**
 * Where a project's own files are guarded from: its root, or its Ork folder
 * when attached.
 */
export const guardedBase = (place: ProjectPlace): string =>
  place.mode === "attached" ? place.dir : place.root;

/**
 * Whether `file` lies under `base` with no link on the way: no folder between
 * them, and not the file itself when it's there, is a symbolic link.
 */
export const plainPathInside = (base: string, file: string): boolean => {
  const relative = path.relative(base, file);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return false;
  }
  let at = base;
  for (const part of relative.split(path.sep)) {
    at = path.join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return false;
    } catch {
      // What isn't there yet can't be a link; nothing below it is there either.
      return true;
    }
  }
  return true;
};

export type Written = { ok: true } | { ok: false; error: string };

/** Writes `text` to `file` under `base`, refusing a path with a link on it. */
export const writePlainFile = (
  base: string,
  file: string,
  text: string,
  shownAs: string = file,
): Written => {
  if (!plainPathInside(base, file)) {
    return {
      ok: false,
      error: `${shownAs} is a link, or behind one: Ork writes only to plain files in the project, so it wrote nothing.`,
    };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const copy = `${file}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(copy, text);
    renameSync(copy, file);
  } finally {
    rmSync(copy, { force: true });
  }
  return { ok: true };
};
