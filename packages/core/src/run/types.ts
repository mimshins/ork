/**
 * @file The scheduler's ports and events. The engine runs a compiled graph;
 *   what each node type does is a `NodeExecutor` supplied by
 *   `@krapht/ork-nodes`, and every change is a `RunEvent` (persisted by the
 *   event store in M1d).
 */

import type { Node, NodeType, Workflow } from "@krapht/ork-schema";

import type {
  HumanChannel,
  RuntimeEvent,
  SessionUsage,
} from "../runtime/types.ts";

export type Inputs = Record<string, string | number | boolean>;

/** A node's output: `nodes.<id>.output`, and `output` in its edges' `when:`. */
export type NodeOutput = Record<string, unknown>;

export type NodeResult = {
  output: NodeOutput;
  /** Whether the node succeeded; an edge without `when:` is taken only then. */
  ok: boolean;
  usage?: SessionUsage;
  /** Why the node failed, for the run summary. */
  error?: string;
};

export type ExecuteContext = {
  runId: string;
  id: string;
  node: Node;
  workflow: Workflow;
  inputs: Inputs;
  /** The latest output of every node that has finished. */
  outputs: Readonly<Record<string, NodeOutput>>;
  /** The output of the node whose edge activated this one. */
  input: NodeOutput | undefined;
  /** 1 on the node's first activation, then 2, 3, … on loop re-entries. */
  round: number;
  cwd: string;
  /** The git checkout the node works in, when the run uses worktrees. */
  checkout?: Checkout;
  /** `.ork/runs/<run>/` in the project: run files that never go on a branch. */
  runDir: string;
  /** What is left of `limits.budgetUsd`, when the run has one. */
  budgetLeftUsd: number | undefined;
  human: HumanChannel;
  /** Forwards a session's runtime events into the run's event stream. */
  emit: (event: RuntimeEvent) => void;
  signal: AbortSignal;
};

export type Checkout = {
  path: string;
  branch: string;
  /** The node's own worktree, or its owner's that it shares or reads. */
  own: boolean;
  /** The node that owns the worktree. */
  owner: string;
};

/** Where nodes work, and what happens to their branches (worktrees, ADR-020). */
export type Workspace = {
  /** The node's checkout; creates its worktree the first time it is needed. */
  prepare: (id: string) => Promise<{ cwd: string; checkout?: Checkout }>;
  /** After a node: commits leftovers, sets `branch`, merges into the owner. */
  finish: (id: string, result: NodeResult) => Promise<NodeResult>;
  /** At the end: removes merged worktrees and lists the kept ones. */
  close: () => Promise<KeptWorktree[]>;
};

export type KeptWorktree = {
  id: string;
  path: string;
  branch: string;
  reason: string;
};

export type NodeExecutor = (context: ExecuteContext) => Promise<NodeResult>;

/** Executors for the node types that do work; control nodes are built in. */
export type NodeExecutors = Partial<Record<NodeType, NodeExecutor>>;

export type RunStatus =
  | "succeeded"
  | "failed"
  | "budget_exhausted"
  | "interrupted";

export type NodeSummary = {
  id: string;
  /** How many times it ran. */
  runs: number;
  ok: boolean | null;
  output: NodeOutput | null;
  error?: string;
  costUsd: number;
};

export type RunResult = {
  runId: string;
  status: RunStatus;
  costUsd: number;
  /** Nodes that ran or were skipped, in the order they first finished. */
  nodes: NodeSummary[];
  /** Why the run did not succeed. */
  reasons: string[];
  /** Worktrees left for the user: root nodes' results, unmerged children. */
  worktrees: KeptWorktree[];
};

export type RunEvent =
  | { type: "run.started"; runId: string; workflow: string; entries: string[] }
  | { type: "node.started"; id: string; nodeType: NodeType; round: number }
  | { type: "node.event"; id: string; event: RuntimeEvent }
  | {
      type: "node.finished";
      id: string;
      round: number;
      ok: boolean;
      output: NodeOutput;
      usage?: SessionUsage;
      error?: string;
    }
  | { type: "node.skipped"; id: string }
  | { type: "edge.taken"; from: string; to: string }
  | { type: "loop.exhausted"; from: string; to: string; maxRounds: number }
  | {
      type: "worktree";
      id: string;
      action: "created" | "committed" | "merged" | "conflict" | "removed";
      path: string;
      branch: string;
      detail?: string;
    }
  | { type: "run.finished"; result: RunResult };
