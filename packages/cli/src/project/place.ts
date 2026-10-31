/**
 * @file Which project a folder belongs to, from the projects the store has
 *   registered (ADR-035): an attached project's files are in
 *   `~/.ork/projects/<id>/`, an in-repo one's in its `.ork/`.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  inside,
  openStore,
  placeFor,
  type ProjectPlace,
  type ProjectRecord,
  storePath,
} from "@krapht/ork-core";

/** The registered projects; none before Ork has a store (never creates one). */
export const registeredProjects = (home?: string): ProjectRecord[] => {
  const file = storePath(home);
  if (!existsSync(file)) return [];
  const store = openStore(file);
  try {
    return store.projects();
  } finally {
    store.close();
  }
};

/** The project `dir` is in: registered, or the in-repo one at its git root. */
export const projectAt = (dir: string, home?: string): ProjectPlace =>
  placeFor(dir, registeredProjects(home));

/** A path to show: relative to `cwd` when inside it, else as it is. */
export const fromCwd = (target: string, cwd: string): string =>
  inside(cwd, target) ? path.relative(cwd, target) || "." : target;
