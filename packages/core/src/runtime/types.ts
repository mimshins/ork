/**
 * @file The port between the engine and a Claude driver. `@krapht/ork-core`
 *   defines it; `@krapht/ork-runtime-claude` implements it with the Agent SDK
 *   and the headless `claude` CLI; tests implement it with a fake.
 */

import type { Driver } from "@krapht/ork-schema";

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
  /** A session id to resume. */
  resume?: string;
};

export type DecisionChoice = {
  id: string;
  label?: string;
  description?: string;
};

/**
 * How a session reaches the human: a permission prompt or a question. The CLI
 * implements it on the terminal; the decision queue replaces it in M1d.
 */
export type HumanChannel = {
  permit: (request: {
    nodeId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<{ allow: true } | { allow: false; message: string }>;
  ask: (question: {
    nodeId: string;
    question: string;
    options: DecisionChoice[];
    recommended?: string;
    context?: string;
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
  | { type: "session.started"; sessionId: string; model: string }
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
  /** Queues a user message; it is delivered between turns. */
  send: (text: string) => void;
  interrupt: () => Promise<void>;
};

export type ClaudeRuntime = {
  driver: Driver;
  start: (spec: SessionSpec, human: HumanChannel) => Session;
};
