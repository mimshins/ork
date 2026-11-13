/**
 * @file The Worktrees panel's part of the API's contract (specs/worktrees.md):
 *   what `ork worktrees` lists, for every project Ork knows, and the read-then
 *   act pairs behind Remove… (`ork worktrees remove`) and Clean merged… (`ork
 *   worktrees clean`). Each act sends the digest of the plan it was shown, so
 *   the server removes only what the person saw. Like the rest of the contract
 *   it imports only `zod` and types, so a browser bundle can use it.
 */

import type {
  MergeState,
  OrkWorktree,
  PlanLine,
  StatePart,
} from "@krapht/ork-core";
import { z } from "zod";

import { listShape } from "./contract-lists.ts";

export type { MergeState, OrkWorktree, PlanLine, StatePart };

const Root = z.string().min(1);

/**
 * The filters are core's `worktreeListTable` fields (`project`: a root; every
 * project without one).
 */
export const WorktreesQuerySchema = z.strictObject(listShape("worktrees"));

export const RemovePlanSchema = z.strictObject({
  project: Root,
  /** The item's branch, or a detached worktree's path. */
  key: z.string().min(1),
  /** Also delete the branch (implied for a branch with no worktree). */
  deleteBranch: z.boolean(),
});

export const RemoveSchema = RemovePlanSchema.extend({
  /** The plan needs it: removing loses work the person was shown. */
  force: z.boolean(),
  /** The plan's digest: what the person saw, so nothing else goes. */
  digest: z.string().min(1),
});

export const CleanPlanSchema = z.strictObject({
  project: Root.optional(),
  /** Also delete the merged branches (`--branches`). */
  branches: z.boolean(),
});

export const CleanSchema = CleanPlanSchema.extend({
  digest: z.string().min(1),
});

export const WORKTREES_API = {
  worktrees: {
    method: "GET",
    path: "/api/worktrees",
    query: WorktreesQuerySchema,
  },
  worktreeRemovePlan: {
    method: "POST",
    path: "/api/worktrees/remove/plan",
    body: RemovePlanSchema,
  },
  worktreeRemove: {
    method: "POST",
    path: "/api/worktrees/remove",
    body: RemoveSchema,
  },
  worktreesCleanPlan: {
    method: "POST",
    path: "/api/worktrees/clean/plan",
    body: CleanPlanSchema,
  },
  worktreesClean: {
    method: "POST",
    path: "/api/worktrees/clean",
    body: CleanSchema,
  },
} as const;

/** One item as the panel shows it, in core's words. */
export type WorktreeRow = OrkWorktree & {
  /** What names it to the remove routes: its branch, or its path. */
  key: string;
  label: string;
  state: MergeState;
  parts: StatePart[];
  run: {
    /** In Ork's records, so the Monitor can show it. */
    known: boolean;
    live: boolean;
  };
  /** Why the default clean keeps a merged item, when it does. */
  cleanKeeps?: string;
  remove: {
    label: "Remove…" | "Delete branch…";
    /** Why it can't be removed at all, by the rule the remove route keeps. */
    refusal?: string;
  };
};

/** A project and what its runs left; `error` when git couldn't read it. */
export type WorktreesProject = {
  root: string;
  name: string;
  /** The current branch, which "merged" is measured against; null detached. */
  head: string | null;
  error?: string;
  /** The command that would fix `error`, if it moved: `ork projects move …`. */
  fix?: string;
  items: WorktreeRow[];
};

/** What a remove would lose, as git prints it, the first lines of each. */
export type Losing = {
  changes: string[];
  commits: string[];
  commitsOn: "unmerged" | "no branch" | null;
  /** How many lines are left out past the first ones. */
  more: { changes: number; commits: number };
};

export type RemovePlanAnswer = {
  /** The item's state as read for this plan, "not merged" saying into what. */
  parts: StatePart[];
  merged: boolean;
  ahead: number;
  line: PlanLine;
  removeWorktree: boolean;
  deleteBranch: boolean;
  prunes: boolean;
  /** It loses work, so removing needs `force` and a second confirm. */
  force: boolean;
  losing: Losing;
  digest: string;
};

export type CleanPlanStep = {
  key: string;
  line: PlanLine;
  removeWorktree: boolean;
  deleteBranch: boolean;
  prunes: boolean;
  skip?: string;
};

export type CleanPlanProject = {
  root: string;
  name: string;
  head: string | null;
  error?: string;
  steps: CleanPlanStep[];
};

export type CleanDone = {
  root: string;
  name: string;
  done: string[];
  /** Git's words, when it stopped partway. */
  error?: string;
};

/** What each worktrees route answers with, on success. */
export type WorktreesResponses = {
  worktrees: { projects: WorktreesProject[] };
  worktreeRemovePlan: RemovePlanAnswer;
  worktreeRemove: { done: string[] };
  worktreesCleanPlan: { projects: CleanPlanProject[]; digest: string };
  worktreesClean: { projects: CleanDone[] };
};
