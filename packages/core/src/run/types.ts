/**
 * @file The scheduler's ports and events. The engine runs a compiled graph;
 *   what each node type does is a `NodeExecutor` supplied by
 *   `@krapht/ork-nodes`, and every change is a `RunEvent`, which the event
 *   store keeps.
 */

import type { Driver, Node, NodeType, Workflow } from "@krapht/ork-schema";

import type { FeedbackPort, FeedbackReport } from "../feedback/types.ts";
import type {
  Claims,
  HoldPoint,
  HoldPort,
  HumanChannel,
  Mailbox,
  OwnerPort,
  Ownership,
  RuntimeEvent,
  SessionEnd,
  SessionPorts,
  SessionUsage,
} from "../runtime/types.ts";
import type { RunLimits } from "../usage/quota.ts";
import type { BusEvent } from "./bus-events.ts";
import type { CallPort } from "./calls.ts";
import type { DecisionEvent, EachEvent } from "./decision-events.ts";
import type { NodeEvent } from "./node-events.ts";
import type { WatchEvent } from "./watch-events.ts";
import type { Checkout, KeptWorktree, Workspace } from "./workspace-types.ts";

export type { Checkout, KeptWorktree, Workspace };

export type Inputs = Record<string, string | number | boolean>;

/** A node's output: `nodes.<id>.output`, and `output` in its edges' `when:`. */
export type NodeOutput = Record<string, unknown>;

export type NodeResult = {
  output: NodeOutput;
  /** Whether the node succeeded; an edge without `when:` is taken only then. */
  ok: boolean;
  usage?: SessionUsage;
  /** Why the node failed, for the run summary: `end.message` once set. */
  error?: string;
  /** How it ended (specs/runtime/session-ends.md); `endOf` reads one when unset. */
  end?: SessionEnd;
  /** The Claude session it ran, so a leader can resume it (ADR-019). */
  sessionId?: string;
  /**
   * Why a limit across runs, not the node's work, ended it (RFC-007). The run
   * then stops, no edge acts on the failure, and a resume goes on.
   */
  limited?: string;
  /** How the run ends with `limited`; `quota_exhausted` when unset. */
  stopsAs?: RunStatus;
  /** Another try might not fail, so a `watch:` looks again (RFC-011). */
  transient?: true;
};

/** The task an owner handed a node through `delegate` or `spawn_worker`. */
export type Brief = { from: string; text: string };

/** One entry of a fanned node's list, for the activation that runs it. */
export type NodeItem = { of: string; index: number; value: unknown };

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
  /** For an item of a fanned node, which entry of the list it runs. */
  item?: NodeItem;
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
  /** How a `workflow.call` node starts and waits on a workflow. */
  calls?: CallPort;
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
  /** What is left of the run's own budget now, with what others have spent. */
  budgetLeftNow?: () => number | undefined;
  /** Sets aside its session's cap from the run's budget; 0 lets it go. */
  reserveBudget?: (usd: number | undefined) => void;
  /** Waits until another node's reserve frees; `false` when none can. */
  budgetFreed?: (signal: AbortSignal) => Promise<boolean>;
  /** What the limits across runs allow now. */
  quota?: () => RunLimits;
  /** What a session has spent in this activation, from its reported total. */
  ownSpend?: (sessionId: string, total: number) => number;
  human: HumanChannel;
  /** The leader a Claude node's questions go to first (ADR-063). */
  owner?: OwnerPort;
  /** Held while the run or this node is paused; a run always passes one. */
  hold?: HoldPort;
  /** Forwards a session's runtime events into the run's event stream. */
  emit: (event: RuntimeEvent) => void;
  /** Aborted when the run is interrupted, or this node is stopped. */
  signal: AbortSignal;
  /** A Claude node's `before:` or `verify:` step and try: its own files. */
  step?: StepRun;
  /** The machine the run shares: its priority and the slots of heavy commands. */
  machine?: NonNullable<SessionPorts["machine"]>;
  /** Records that a `once: true` check was skipped (`verify.skipped`). */
  skipped?: (check: string, pass: { at: string; who: string }) => void;
};

/** A node's `before:` or `verify:` step, and which try of it this is. */
export type StepRun = { name: "before" | "verify"; try: number };

export type NodeExecutor = (context: ExecuteContext) => Promise<NodeResult>;

/** Executors for the node types that do work; control nodes are built in. */
export type NodeExecutors = Partial<Record<NodeType, NodeExecutor>>;

export type RunStatus =
  | "succeeded"
  | "failed"
  | "budget_exhausted"
  | "quota_exhausted"
  | "timed_out"
  | "interrupted";

export type NodeSummary = {
  id: string;
  /** How many times it ran. */
  runs: number;
  ok: boolean | null;
  output: NodeOutput | null;
  error?: string;
  /** How its last run failed; a called run's failure carries it up. */
  end?: SessionEnd;
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
  /** The workflow's `outputs`, rendered when the run ended. */
  outputs?: Record<string, string>;
  /**
   * How many nodes were skipped, and how many failed results had an edge to
   * take, so the run went on: a `succeeded` run says what it left out (G8).
   * Absent from results recorded before they were counted.
   */
  skipped?: number;
  failuresHandled?: number;
  /**
   * Nodes that never ran, with how many messages to them nobody read: a branch
   * not taken leaves its mail unread (L91). Absent when there are none.
   */
  unread?: UnreadMail[];
};

/** A node that never ran, and the messages to it that stayed unread. */
export type UnreadMail = { node: string; messages: number };

export type RunNodeInfo = { id: string; type: NodeType; parent?: string };

/** A declared edge, as the run recorded it: what its graph is drawn from. */
export type RunEdgeInfo = {
  from: string;
  to: string;
  when?: string;
  maxRounds?: number;
};

/** How the run was started, kept so `ork resume` starts it the same way. */
export type RunSettings = {
  inPlace?: boolean;
  driver?: Driver;
  /** The driver ready when the run started, for nodes that name none. */
  readyDriver?: Driver;
  /**
   * Its Claude sessions load the machine's MCP servers and auto-memory
   * (`--machine-claude`, ADR-065); absent, they start clean.
   */
  machineClaude?: boolean;
  /** The rules turned links off: this run's nodes cannot be linked. */
  links?: "off";
  /** A caller capped this run's budget to what it had left (RFC-004). */
  budgetCap?: number;
  /** The call that started this run, as `<run>/<node>`. */
  calledBy?: string;
  /** What this run's worktrees start from, instead of the project's `HEAD`. */
  baseRef?: string;
  /** The trigger that started this run (RFC-011). */
  trigger?: string;
  /** Inputs from what its check reported, which anyone may have written. */
  untrusted?: string[];
};

export type RunEvent =
  | {
      type: "run.started";
      runId: string;
      workflow: string;
      entries: string[];
      /** Every declared node, with its owner: the shape `ork tree` draws. */
      nodes: RunNodeInfo[];
      /** Its edges and channels, absent on runs from before they were kept. */
      edges?: RunEdgeInfo[];
      channels?: [string, string][];
      inputs?: Inputs;
      settings?: RunSettings;
      /** What the run may spend, if there's a limit: for showing against. */
      budgetUsd?: number;
      /** The Ork version that started it; absent on runs from before. */
      ork?: string;
    }
  /** `ork resume` continues the run, `ork` that version; `kept` keep results. */
  | { type: "run.resumed"; kept: string[]; ork?: string }
  | NodeEvent
  | { type: "edge.taken"; from: string; to: string }
  | { type: "loop.exhausted"; from: string; to: string; maxRounds: number }
  | WatchEvent
  | EachEvent
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
  | DecisionEvent
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
  /** A heavy command waits for a machine-wide slot, held by `<run>/<node>`s. */
  | { type: "slot.waiting"; id: string; holders: string[] }
  /** The command that waited got its slot. */
  | { type: "slot.taken"; id: string }
  | BusEvent
  /** A feedback record: an agent's report, or a signal Ork derived. */
  | { type: "feedback.recorded"; node?: string; feedback: FeedbackReport }
  | { type: "run.finished"; result: RunResult };
