/**
 * @file The port between the engine and a Claude driver. `@krapht/ork-core`
 *   defines it; `@krapht/ork-runtime-claude` implements it with the Agent SDK
 *   and the headless `claude` CLI; tests implement it with a fake.
 */

import type { Driver, Effort } from "@krapht/ork-schema";

import type { REPORT_STATUSES } from "../graph/types.ts";

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

export type ToolRules = { allow: string[]; deny: string[] };

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
  /** Local plugin folders to load: Ork's skills for this node. */
  plugins?: string[];
  /** Extra Claude Code settings (`--settings`), e.g. `skillOverrides`. */
  settings?: Record<string, unknown>;
  /** A session id to resume. */
  resume?: string;
};

export type DecisionChoice = {
  id: string;
  label?: string;
  description?: string;
};

/**
 * How a session reaches the human: a permission prompt or a question. In a run
 * it is the decision queue, which records each one and takes the first answer
 * from the terminal or `ork decide`.
 */
export type HumanChannel = {
  permit: (request: {
    nodeId: string;
    toolName: string;
    input: Record<string, unknown>;
    /** Withdraws the prompt, e.g. when another terminal answered it. */
    signal?: AbortSignal;
  }) => Promise<{ allow: true } | { allow: false; message: string }>;
  ask: (question: {
    nodeId: string;
    question: string;
    options: DecisionChoice[];
    recommended?: string;
    context?: string;
    /** Withdraws the question, e.g. when a gate's timeout answers it. */
    signal?: AbortSignal;
  }) => Promise<string>;
};

export type SessionUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  durationMs: number;
};

export type SessionOutcome = {
  /** `success`, or the driver's error subtype (e.g. `error_max_turns`). */
  subtype: string;
  sessionId: string;
  /** `null` when the session ended without a valid report. */
  report: NodeReport | null;
  /** The final assistant text. */
  text: string;
  usage: SessionUsage;
  errors: string[];
};

/** Normalized events, the same for every driver. */
export type RuntimeEvent =
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
  | {
      type: "tool.called";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool.result"; id: string; isError: boolean }
  | { type: "session.finished"; outcome: SessionOutcome };

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
  /** Declared child workers `spawn` can start more instances of. */
  templates: string[];
  /** How many more workers `spawn` may start. */
  workersLeft: () => number;
  delegate: (tasks: DelegateTask[]) => Promise<Delegation>;
  spawn: (tasks: SpawnTask[]) => Promise<Delegation>;
};

/** A message in a node's inbox. */
export type InboxMessage = { id: number; from: string; body: string };

export type SendResult =
  | { ok: true; delivered: "now" | "queued" }
  | { ok: false; error: string };

/**
 * A node's place on the run's message bus: whom it may write to, its inbox, and
 * the owner questions it answers. The bus pushes a one-line notice into a live
 * session; the session pulls the bodies with `read`.
 */
export type Mailbox = {
  /** Its owner, its children (and their spawned instances), its channels. */
  peers: () => string[];
  send: (to: string, body: string) => SendResult;
  /** Unread messages, oldest first; they count as read after this. */
  read: () => InboxMessage[];
  /** Answers a question Ork asked this node as an owner. */
  answer: (
    question: string,
    choice: string,
  ) => { ok: true } | { ok: false; error: string };
  /**
   * Connects the node's live session: notices go to `deliver` until the
   * returned function disconnects it. Questions still open then go back to
   * whoever asked, unanswered.
   */
  connect: (deliver: (text: string) => void) => () => void;
};

/** What a session can reach besides its spec: the human, its children, peers. */
export type SessionPorts = {
  human: HumanChannel;
  /** Only for a leader inside a run. */
  ownership?: Ownership;
  /** Only for a leader or worker inside a run. */
  mailbox?: Mailbox;
};

export type ClaudeRuntime = {
  driver: Driver;
  start: (spec: SessionSpec, ports: SessionPorts) => Session;
};
