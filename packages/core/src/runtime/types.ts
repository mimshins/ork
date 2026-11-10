/**
 * @file The port between the engine and an agent driver. `@krapht/ork-core`
 *   defines it; `@krapht/ork-runtime` implements it (through the headless CLIs
 *   of `claude`, `opencode` and `cmd`); tests implement it with a fake.
 */

import type { Driver, Effort } from "@krapht/ork-schema";

import type { FeedbackPort } from "../feedback/types.ts";
import type { REPORT_STATUSES } from "../graph/types.ts";
import type {
  DecisionChoice,
  HumanChannel,
  HumanQuestion,
  NoteTaker,
  OwnerPort,
} from "./human.ts";
import type {
  InboxMessage,
  Mailbox,
  MessageVia,
  RelayPort,
  SendResult,
} from "./mailbox.ts";
import type { SessionOutcome, SessionUsage } from "./outcome.ts";

export type { InboxMessage, Mailbox, MessageVia, RelayPort, SendResult };
export type { SessionEnd } from "./ends.ts";
export type { SessionOutcome, SessionUsage };
export type {
  DecisionChoice,
  HumanChannel,
  HumanQuestion,
  NoteTaker,
  OwnerPort,
};

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What a Claude node hands back to its owner when it finishes. */
export type NodeReport = {
  status: ReportStatus;
  summary: string;
  /** Artifact name -> repository-relative path. */
  artifacts: Record<string, string>;
  branch?: string;
  /** The extra fields the node's `output.schema` asks for. */
  fields: Record<string, unknown>;
};

/**
 * `only`: the built-in tools the session has at all; Ork's own tools stay.
 * `strictMcp`: no MCP server but Ork's, none from the project's settings or
 * plugins (`--strict-mcp-config`; the SDK's `strictMcpConfig`), even when the
 * run loads the machine's Claude setup (`machineClaude`).
 */
export type ToolRules = {
  allow: string[];
  deny: string[];
  only?: string[];
  strictMcp?: boolean;
};

/** A Claude Code subagent the session can hand work to (`claude.subagent`). */
export type SubagentSpec = {
  description: string;
  /** Its system prompt. */
  prompt: string;
  model?: string;
  /** The only tools it has; all of the session's when unset. */
  tools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
};

/** Everything a driver needs to start one session. */
export type SessionSpec = {
  nodeId: string;
  cwd: string;
  model?: string;
  effort?: Effort;
  /** The rendered task brief: the session's first user message. */
  prompt: string;
  /** Appended to Claude Code's own system prompt. */
  systemAppend: string;
  /** Claude Code setting sources to load; Ork never loads `user`. */
  settingSources: ("project" | "local")[];
  tools: ToolRules;
  permissionMode: "default" | "acceptEdits" | "plan";
  maxTurns?: number;
  budgetUsd?: number;
  /** JSON Schema of the final report (structured output). */
  reportSchema: Record<string, unknown>;
  /** Its `claude.subagent` children, by node id. */
  agents?: Record<string, SubagentSpec>;
  /** Local plugin folders to load: Ork's skills for this node. */
  plugins?: string[];
  /** Extra Claude Code settings (`--settings`), e.g. `skillOverrides`. */
  settings?: Record<string, unknown>;
  /** A session id to resume. */
  resume?: string;
  /**
   * With `resume`: start a new session from a copy of that one, leaving it as
   * it was (`--fork-session`; the SDK's `forkSession`).
   */
  fork?: boolean;
  /**
   * The prompt cache's lifetime, when longer than Claude Code's 5 minutes: a
   * leader waits on its children longer than that, and would write its prefix
   * again after each wait (specs/context.md).
   */
  promptCache?: "1h";
  /**
   * Load the machine's own Claude setup: its MCP servers and Claude Code's
   * auto-memory (`ork run --machine-claude`, ADR-065). Unset, a session loads
   * only Ork's MCP server, and no memory.
   */
  machineClaude?: boolean;
  /**
   * The named servers' `.mcp.json` entries as written, by name, that load
   * beside Ork's (`mcp:` on a node or `defaults`). Unset means none. Passed to
   * the driver untouched; never put in an event.
   */
  mcpServers?: Record<string, Record<string, unknown>>;
};

/** What Claude Code says of a subscription's rate limit (RFC-007). */
export type PlanReport = {
  status: "allowed" | "allowed_warning" | "rejected";
  /** `five_hour`, `seven_day` and so on; `plan` when it does not say. */
  window: string;
  resetsAt?: string;
};

/** The latest report of one of a plan's limits, as a store keeps it. */
export type PlanLimit = PlanReport & { at: string };

/**
 * Normalized events, the same for every driver. `fork` marks every event of a
 * fork (`SessionSpec.fork`) Ork records under the node it copied: it is not
 * that node's own session, nor its words (ADR-063).
 */
export type RuntimeEvent = (
  | {
      type: "session.started";
      sessionId: string;
      model: string;
      /** Where the session runs; it can be resumed only from there. */
      cwd?: string;
      /** The driver that runs it. */
      driver?: Driver;
    }
  | { type: "assistant.text"; text: string }
  /**
   * The session waits before its tool starts, e.g. for its checkout: Command
   * Code runs one session per checkout (RFC-014). Nothing derives from it.
   */
  | { type: "session.waiting"; reason: string }
  | {
      type: "tool.called";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool.result"; id: string; isError: boolean }
  | ({ type: "plan.limit" } & PlanReport)
  | {
      type: "session.finished";
      outcome: SessionOutcome;
    }
) & { fork?: boolean };

export type Session = {
  events: AsyncIterable<RuntimeEvent>;
  /**
   * Queues a user message; Claude Code shows it at the next point between steps
   * (`priority: "next"`), mid-turn or not.
   */
  send: (text: string) => void;
  interrupt: () => Promise<void>;
};

/** One piece of work a leader hands to a declared child (ADR-017). */
export type DelegateTask = { child: string; brief: string };

/** One piece of work a leader hands to a new instance of a child worker. */
export type SpawnTask = { template: string; brief: string };

/** What came back from one delegated or spawned child. */
export type ChildReport = {
  /** The child's id; a spawned worker's is `<template>-<n>`. */
  child: string;
  ok: boolean;
  /** The child's output: its report, `branch`, and `merge` on a conflict. */
  output: Record<string, unknown>;
  error?: string;
};

/** The reports, and anything the leader should know about how they ran. */
export type Delegation = { reports: ChildReport[]; notes: string[] };

/** A child a leader may delegate to. */
export type OwnedChild = { id: string; type: string; description?: string };

/**
 * What a leader's session can do with the nodes it owns, provided by the
 * scheduler. Both calls block until every child has reported (ADR-017).
 */
export type Ownership = {
  children: OwnedChild[];
  /** Children left out of `children` as they run per item, from their edges. */
  fanned?: readonly string[];
  /** Declared child workers `spawn` can start more instances of. */
  templates: string[];
  /** How many more workers `spawn` may start. */
  workersLeft: () => number;
  delegate: (tasks: DelegateTask[]) => Promise<Delegation>;
  spawn: (tasks: SpawnTask[]) => Promise<Delegation>;
};

/** A message in a node's inbox. */
export type ClaimResult =
  | { ok: true; resource: string; already: boolean }
  | { ok: false; error: string };

/**
 * A node's claims on files, folders and other resources, shared by the run, so
 * nodes that run at the same time do not change the same thing. A path claim
 * covers everything under it.
 */
export type Claims = {
  /** Whether another node may write at the same time: then it gets the tools. */
  contended: () => boolean;
  /** Takes `resource`, or says who holds it (or something it overlaps). */
  claim: (resource: string) => ClaimResult;
  release: (resource: string) => ClaimResult;
  /** What the node holds now. */
  held: () => string[];
};

/** Where a node stops to wait while it is held (paused). */
export type HoldPoint = "tool" | "start";

/**
 * Whether a node may go on, for a paused run or node (ADR-041). A session waits
 * at its next tool call; nothing it is doing is cut short.
 */
export type HoldPort = {
  /** Whether the node is held now: its run is paused, or the node is. */
  held: () => boolean;
  /**
   * Resolves once the node is not held, at once when it is not. While a node
   * waits, the run records it as held; `signal` gives up the wait.
   */
  wait: (at: HoldPoint, signal?: AbortSignal) => Promise<void>;
  /** Calls `listener` whenever `held()` may have changed; returns its undo. */
  watch: (listener: () => void) => () => void;
};

/** What a session can reach besides its spec: the human, its children, peers. */
export type SessionPorts = {
  human: HumanChannel;
  /** Only inside a run: held while the run or the node is paused. */
  hold?: HoldPort;
  /** Only for a leader inside a run. */
  ownership?: Ownership;
  /** Only for a leader or worker inside a run. */
  mailbox?: Mailbox;
  /** Only for a leader or worker inside a run. */
  claims?: Claims;
  /** Only for a leader or worker inside a run. */
  feedback?: FeedbackPort;
  /** What the workflow sent back to the node, whole, when its note was cut. */
  input?: string;
};

export type AgentRuntime = {
  driver: Driver;
  start: (spec: SessionSpec, ports: SessionPorts) => Session;
};
