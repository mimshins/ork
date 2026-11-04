/**
 * @file A workflow's file for the builder (RFC-008): reading it only where it
 *   stays inside the project, and writing it, the one place the server writes
 *   into a project, whole or not at all and never through a link.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { inside, type ProjectRecord } from "@krapht/ork-core";

/** Most file systems stop at 255 bytes, and the suffix takes some of those. */
const LONGEST_NAME = 200;

/** A name that stays one file in the workflows folder. */
export const safeName = (name: string): boolean =>
  name.length > 0 &&
  Buffer.byteLength(name) <= LONGEST_NAME &&
  path.basename(name) === name &&
  !name.startsWith(".") &&
  !name.includes("\\") &&
  !name.includes("\0");

/** Call only once `unreadableReason` has passed the file. */
export const readText = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, "utf8") : undefined;

const hashOf = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** A file by its contents, or `null` when there's none. */
export const hashOfFile = (file: string): string | null => {
  const text = readText(file);
  return text === undefined ? null : hashOf(text);
};

/** The folder a project's own files must stay in, links resolved. */
const homeOf = (project: ProjectRecord): string =>
  realpathSync(
    // `.ork` in a repository can itself be a link, so the repository is the
    // boundary there. An attached project's folder stands on its own.
    inside(project.root, project.dir) ? project.root : project.dir,
  );

/** Whether something is at `at`, even a link that leads nowhere. */
const isThere = (at: string): boolean =>
  lstatSync(at, { throwIfNoEntry: false }) !== undefined;

/** The nearest existing folder on the way to `file`. */
const nearestFolder = (file: string): string => {
  let folder = path.dirname(file);
  while (!isThere(folder) && path.dirname(folder) !== folder) {
    folder = path.dirname(folder);
  }
  return folder;
};

const folderOutside = (project: ProjectRecord, file: string): boolean => {
  const folder = nearestFolder(file);
  // A link that leads nowhere can't be resolved, so it can't be trusted.
  return (
    !existsSync(folder) ||
    !existsSync(project.root) ||
    !existsSync(project.dir) ||
    !inside(homeOf(project), realpathSync(folder))
  );
};

const LEADS_OUT =
  "The workflows folder leads out of the project, so Ork won't use it.";

/** Why this file may not be read; a link could lead out of the project. */
export const unreadableReason = (
  project: ProjectRecord,
  file: string,
): string | undefined => {
  if (folderOutside(project, file)) return LEADS_OUT;
  if (!isThere(file)) return undefined;
  if (!existsSync(file) || !inside(homeOf(project), realpathSync(file))) {
    return `${path.basename(file)} is a link that leads out of the project, so Ork won't read it.`;
  }
  return statSync(file).isFile()
    ? undefined
    : `${path.basename(file)} isn't a file.`;
};

/** Why this file may not be written: it must not be a link at all. */
export const outsideReason = (
  project: ProjectRecord,
  file: string,
): string | undefined => {
  if (folderOutside(project, file)) return LEADS_OUT;
  const found = lstatSync(file, { throwIfNoEntry: false });
  if (found?.isSymbolicLink() === true) {
    return `${path.basename(file)} is a symbolic link, so Ork won't write through it.`;
  }
  return found === undefined || found.isFile()
    ? undefined
    : `${path.basename(file)} isn't a file.`;
};

/** Writes `text` so that a reader sees the old file or the new, never part. */
export const writeWhole = (file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  // `wx` fails rather than follow anything already at that name.
  writeFileSync(temporary, text, { flag: "wx" });
  try {
    if (existsSync(file)) chmodSync(temporary, statSync(file).mode);
    renameSync(temporary, file);
  } catch (failed) {
    rmSync(temporary, { force: true });
    throw failed;
  }
};
