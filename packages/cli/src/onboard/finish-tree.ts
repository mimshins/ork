/**
 * @file Where `ork __onboard finish` finds the project's files in the writer's
 *   worktree. The worktree is the whole repository's, so a project that is a
 *   subfolder of its repository has its files under that folder; every read and
 *   write goes through the plain-file guards.
 */

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { plainPathInside } from "@krapht/ork-core";

/**
 * The project's folder in the repository (`""` or `"sub/"`) with the worktree
 * the writer worked in.
 */
export type Scene = { worktree: string; prefix: string };

/** Where the project's `file` is in the worktree. */
export const inWorktree = (scene: Scene, file: string): string =>
  path.join(scene.worktree, scene.prefix, file);

/** A project file of the worktree's text, or the reason it cannot be read. */
export const readInWorktree = (
  scene: Scene,
  file: string,
): { text: string } | { error: string } => {
  const absolute = inWorktree(scene, file);
  if (!plainPathInside(scene.worktree, absolute)) {
    return { error: "is a link, or behind one" };
  }
  try {
    if (!lstatSync(absolute).isFile()) return { error: "is not a file" };
    return { text: readFileSync(absolute, "utf8") };
  } catch {
    return { error: "cannot be read" };
  }
};
