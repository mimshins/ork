/** @file The port a run's worktrees sit behind, and what it hands the scheduler. */

import type { NodeResult } from "./types.ts";

export type Checkout = {
  path: string;
  /** Absent when the worktree is detached (`commit: never`). */
  branch?: string;
  /** The project's git rules: may it commit, how its work reaches its owner. */
  commit?: "auto" | "never";
  merge?: "auto" | "patch" | "never";
  /** The node's own worktree, or its owner's that it shares or reads. */
  own: boolean;
  /** The node that owns the worktree. */
  owner: string;
};

/** Where nodes work, and what happens to their branches (worktrees, ADR-020). */
export type Workspace = {
  /**
   * The node's checkout; creates its worktree the first time it is needed and
   * brings it up to date with its owner's branch on later runs. `template` is
   * the declared node a spawned worker is an instance of.
   */
  prepare: (
    id: string,
    template?: string,
  ) => Promise<{ cwd: string; checkout?: Checkout }>;
  /**
   * Before a leader delegates: commits its work so far, so children branch from
   * it. Returns why it could not, or `null`.
   */
  checkpoint: (id: string) => Promise<string | null>;
  /** After a node: commits leftovers, sets `branch`, merges into the owner. */
  finish: (id: string, result: NodeResult) => Promise<NodeResult>;
  /** At the end: removes merged worktrees and lists the kept ones. */
  close: () => Promise<KeptWorktree[]>;
};

export type KeptWorktree = {
  id: string;
  path: string;
  branch?: string;
  reason: string;
};
