/**
 * @file What a run's workspace leaves when the run ends (ADR-020): a merged
 *   child's worktree is removed (its branch stays); every other worktree is
 *   kept, with the reason the run summary shows.
 */

import type { KeptWorktree } from "../run/types.ts";
import { keptOf, type Tracked } from "./handoff.ts";
import { removeWorktree } from "./manager.ts";

export type CloseOptions = {
  root: string;
  /** `commit: never`: worktrees hold uncommitted work, removed by force. */
  never: boolean;
  worktrees: ReadonlyMap<string, Tracked>;
  merged: ReadonlySet<string>;
  /** Why a worktree was not merged, by node. */
  unmerged: ReadonlyMap<string, string>;
  ownerOf: (id: string) => string | undefined;
  onRemoved: (id: string, worktree: Tracked) => void;
};

const reasonOf = (options: CloseOptions, id: string): string => {
  const why = options.unmerged.get(id);
  if (why !== undefined) return why;
  if (options.ownerOf(id) !== undefined) return "not merged";
  return options.never ? "the run's result, uncommitted" : "the run's result";
};

/** Removes merged children's worktrees and lists the ones the run keeps. */
export const closeWorktrees = async (
  options: CloseOptions,
): Promise<KeptWorktree[]> => {
  const kept: KeptWorktree[] = [];
  for (const [id, worktree] of options.worktrees) {
    if (!options.merged.has(id) || options.unmerged.has(id)) {
      kept.push({ ...keptOf(id, worktree), reason: reasonOf(options, id) });
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
      await removeWorktree(options.root, worktree.path, options.never);
      options.onRemoved(id, worktree);
    } catch {
      kept.push({ ...keptOf(id, worktree), reason: "could not be removed" });
    }
  }
  return kept;
};
