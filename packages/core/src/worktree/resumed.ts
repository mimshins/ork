/**
 * @file What a resumed run's workspace starts from: the worktrees the run left
 *   whose folders are still there, and where each replayed node worked. A
 *   replayed node is never prepared again, so without this a `continue` or
 *   `readonly` node after it would not find the worktree its input came from.
 */

import { existsSync } from "node:fs";

import type { Tracked } from "./handoff.ts";

/** A worktree a resumed run left. */
export type AdoptedWorktree = {
  id: string;
  path: string;
  branch?: string;
  snapshot?: string;
  merged: boolean;
};

/**
 * Adopts the worktrees still there, and records where replayed nodes worked: an
 * adopted worktree's own node there, and a node without one (a `readonly`
 * reviewer, a fanned item) where its last session ran, when that is one of
 * them.
 */
export const seedResumed = (
  adopt: readonly AdoptedWorktree[],
  places: ReadonlyMap<string, string>,
  into: {
    worktrees: Map<string, Tracked>;
    placeOf: Map<string, string>;
    merged: Set<string>;
  },
): void => {
  for (const left of adopt) {
    if (!existsSync(left.path)) continue;
    const { id, merged: wasMerged, ...worktree } = left;
    into.worktrees.set(id, worktree);
    into.placeOf.set(id, worktree.path);
    if (wasMerged) into.merged.add(id);
  }
  const adopted = new Set([...into.worktrees.values()].map(w => w.path));
  for (const [id, place] of places) {
    if (!into.placeOf.has(id) && adopted.has(place))
      into.placeOf.set(id, place);
  }
};

/** What a resumed run's events say its workspace starts from. */
export type ResumedPlaces = {
  worktrees: readonly AdoptedWorktree[];
  places: ReadonlyMap<string, string>;
  branches: readonly string[];
};

/** The workspace options for a resumed run; none for a new one. */
export const resumedOptions = (
  resume: ResumedPlaces | undefined,
): {
  adopt?: readonly AdoptedWorktree[];
  places?: ReadonlyMap<string, string>;
  known?: readonly string[];
} =>
  resume === undefined
    ? {}
    : {
        adopt: resume.worktrees,
        places: resume.places,
        known: resume.branches,
      };
