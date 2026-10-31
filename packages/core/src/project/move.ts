/**
 * @file Moving files between folders without losing any (ADR-036): a plan of
 *   steps (move a file or folder, make a folder a link, drop emptied folders),
 *   checked for clashes before anything moves, then applied in order. `ork
 *   migrate` uses it to bring an attached project into `.ork/`, and a project's
 *   agents and skills under `.ork/`.
 */

import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { inside } from "../context/files.ts";

export type MoveStep =
  /** Moves a file or folder to `to`, which does not exist. */
  | { kind: "move"; from: string; to: string }
  /** Makes `at` (missing, an empty folder, or a link) a relative link to `to`. */
  | { kind: "link"; at: string; to: string }
  /** Removes the empty folders at and under `path`; anything else stays. */
  | { kind: "prune"; path: string };

export type MovePlan = {
  steps: MoveStep[];
  /** Paths that would be moved onto something already there. */
  clashes: string[];
};

const lstatOf = (target: string): Stats | undefined => {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
};

/** Where what will be at `target` once `steps` ran is now. */
const sourceOf = (target: string, steps: readonly MoveStep[]): string => {
  const step = steps.findLast(s => s.kind === "move" && inside(s.to, target));
  return step?.kind === "move"
    ? path.join(step.from, path.relative(step.to, target))
    : target;
};

/**
 * Adds the steps that move `from` to `to` to `plan`. Onto nothing, it moves
 * whole; onto a folder, a folder's entries move one by one; anything else is a
 * clash. Earlier steps in the plan count as done.
 */
export const planMoveInto = (
  from: string,
  to: string,
  plan: MovePlan,
): void => {
  const there = lstatOf(sourceOf(to, plan.steps));
  if (there === undefined) {
    plan.steps.push({ kind: "move", from, to });
    return;
  }
  if (there.isDirectory() && lstatOf(from)?.isDirectory() === true) {
    for (const name of readdirSync(from).toSorted()) {
      planMoveInto(path.join(from, name), path.join(to, name), plan);
    }
    return;
  }
  plan.clashes.push(to);
};

const move = (from: string, to: string): void => {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    // Another file system (~/.ork on one disk, the repository on another).
    if (
      !(error instanceof Error && "code" in error && error.code === "EXDEV")
    ) {
      throw error;
    }
    cpSync(from, to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    rmSync(from, { recursive: true });
  }
};

const link = (at: string, to: string): void => {
  const stat = lstatOf(at);
  if (stat?.isSymbolicLink() === true) unlinkSync(at);
  // Fails on a folder that is not empty, so nothing is lost.
  else if (stat?.isDirectory() === true) rmdirSync(at);
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(path.relative(path.dirname(at), to), at, "dir");
};

const prune = (target: string): void => {
  if (lstatOf(target)?.isDirectory() !== true) return;
  for (const name of readdirSync(target)) prune(path.join(target, name));
  if (readdirSync(target).length === 0) rmdirSync(target);
};

/** Applies a plan's steps in order; it stops at the first that fails. */
export const applySteps = (steps: readonly MoveStep[]): void => {
  for (const step of steps) {
    if (step.kind === "move") move(step.from, step.to);
    else if (step.kind === "link") link(step.at, step.to);
    else prune(step.path);
  }
};
