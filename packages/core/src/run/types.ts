/**
 * @file The scheduler's ports and events. The engine runs a compiled graph;
 *   what each node type does is a `NodeExecutor` supplied by
 *   `@krapht/ork-nodes`, and every change is a `RunEvent`, which the event
 *   store keeps.
 */

import type { Driver, Node, NodeType, Workflow } from "@krapht/ork-schema";

import type { AgentRef } from "../agents/apply.ts";
import type { FeedbackPort, FeedbackReport } from "../feedback/types.ts";
import type {
  Claims,
  DecisionChoice,
  HoldPoint,
  HoldPort,
  HumanChannel,
  Mailbox,
  Ownership,
  RuntimeEvent,
  SessionUsage,
} from "../runtime/types.ts";
import type { AnsweredBy, DecisionKind } from "../store/types.ts";
import type { BusEvent } from "./bus-events.ts";

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
  /** The Claude session it ran, so a leader can resume it (ADR-019). */
  sessionId?: string;
};

/** The task an owner handed a node through `delegate` or `spawn_worker`. */
export type Brief = { from: string; text: string };

export type ExecuteContext = {
  runId: string;
  id: string;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
  node: Node;
  workflow: Workflow;
  inputs: Inputs;
  /** The latest output of every node that has finished. */
  outputs: Readonly<Record<string, NodeOutput>>;
  /** The output of the node whose edge activated this one. */
  input: NodeOutput | undefined;
  /** 1 on the node's first activation, then 2, 3, … on loop re-entries. */
  round: number;
  /** Set when the node's owner delegated this run. */
  brief?: Brief;
  /** A leader's previous session, resumed on re-entry (ADR-019). */
  resume?: string;
  /** For a leader: its children, through `delegate` and `spawn_worker`. */
  ownership?: Ownership;
  /** The node's place on the run's message bus. */
  mailbox?: Mailbox;
  /** The node's claims on files and resources, shared by the run. */
  claims?: Claims;
  /** Where the node's session reports feedback (the `feedback` tool). */
  feedback?: FeedbackPort;
  cwd: string;
  /** The git checkout the node works in, when the run uses worktrees. */
  checkout?: Checkout;
  /** `.ork/runs/<run>/` in the project: run files that never go on a branch. */
  runDir: string;
  /** The workflow file's folder; skill and context paths start there. */
  workflowDir: string;
  /** The project's root; skill and context paths may not leave it. */
  projectRoot: string;
  /** Ork's folder for the project, which lessons are read from. */
  orkDir?: string;
  /** What is left of `limits.budgetUsd`, when the run has one. */
  budgetLeftUsd: number | undefined;
  human: HumanChannel;
  /** Held while the run or this node is paused; a run always passes one. */
  hold?: HoldPort;
  /** Forwards a session's runtime events into the run's event stream. */
  emit: (event: RuntimeEvent) => void;
  /** Aborted when the run is interrupted, or this node is stopped. */
  signal: AbortSignal;
};

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

export type NodeExecutor = (context: ExecuteContext) => Promise<NodeResult>;

/** Executors for the node types that do work; control nodes are built in. */
export type NodeExecutors = Partial<Record<NodeType, NodeExecutor>>;

export type RunStatus =
  | "succeeded"
  | "failed"
  | "budget_exhausted"
  | "timed_out"
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

export type RunNodeInfo = { id: string; type: NodeType; parent?: string };

/** How the run was started, kept so `ork resume` starts it the same way. */
export type RunSettings = { inPlace?: boolean; driver?: Driver };

export type RunEvent =
  | {
      type: "run.started";
      runId: string;
      workflow: string;
      entries: string[];
      /** Every declared node, with its owner: the shape `ork tree` draws. */
      nodes: RunNodeInfo[];
      inputs?: Inputs;
      settings?: RunSettings;
    }
  /** `ork resume` continues the run; `kept` nodes keep their results. */
  | { type: "run.resumed"; kept: string[] }
  | {
      type: "node.started";
      id: string;
      nodeType: NodeType;
      round: number;
      /** The leader that delegated this run, if one did. */
      owner?: string;
      /** The agent that fills the node, if one does. */
      agent?: AgentRef;
    }
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
      action:
        | "created"
        | "synced"
        | "committed"
        | "merged"
        | "conflict"
        | "removed";
      path: string;
      /** Absent for a detached worktree (`commit: never`). */
      branch?: string;
      /** The tree its own work is measured from, for patches (created, synced). */
      snapshot?: string;
      detail?: string;
    }
  | {
      type: "decision.opened";
      node: string;
      decision: string;
      kind: DecisionKind;
      question: string;
      options: DecisionChoice[];
      recommended?: string;
    }
  | {
      type: "decision.answered";
      node: string;
      decision: string;
      answer: string;
      by: AnsweredBy;
    }
  | { type: "decision.withdrawn"; node: string; decision: string }
  /**
   * Another process asked the run to do something: `ork stop`, `ork pause`,
   * `ork continue`; `node` when it names one node, not the whole run.
   */
  | {
      type: "run.command";
      command: "stop" | "pause" | "continue";
      node?: string;
    }
  /** A paused node reached a hold point and waits (ADR-041). */
  | { type: "node.held"; id: string; at: HoldPoint }
  /** A held node goes on. */
  | { type: "node.released"; id: string }
  | BusEvent
  /** A feedback record: an agent's report, or a signal Ork derived. */
  | { type: "feedback.recorded"; node?: string; feedback: FeedbackReport }
  | { type: "run.finished"; result: RunResult };
