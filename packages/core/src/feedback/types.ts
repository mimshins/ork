/**
 * @file Feedback's shapes (specs/feedback.md): what an agent reports with the
 *   `feedback` tool, what Ork derives from a run's events, and the record each
 *   becomes in the run's events and the store.
 */

export const FEEDBACK_KINDS = [
  "friction",
  "bug",
  "context-gap",
  "skill",
  "workflow",
  "idea",
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_TARGETS = ["ork", "workflow", "project"] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

export const FEEDBACK_SEVERITIES = ["low", "medium", "high"] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

/** Where a record came from: Ork's own signals, an agent, or a person. */
export type FeedbackSource = "system" | "agent" | "human";

/** The records' format, for migrations. */
export const FEEDBACK_VERSION = 1;

/** What an agent reports; Ork fills in the rest. */
export type FeedbackDraft = {
  kind: FeedbackKind;
  /** Default: from the kind (`bug` is about Ork, `context-gap` the project). */
  target?: FeedbackTarget;
  severity?: FeedbackSeverity;
  title: string;
  body?: string;
  /** Artifact paths, tool names, event ids; never pasted file contents. */
  evidence?: string[];
};

/** Where and with what a record was made. */
export type FeedbackOrigin = {
  workflow?: string;
  /** The workflow file's content hash. */
  workflowHash?: string;
  nodeType?: string;
  model?: string;
  driver?: string;
  /** Ork's version. */
  version?: string;
};

/** One feedback record, as the run's `feedback.recorded` event carries it. */
export type FeedbackReport = {
  source: FeedbackSource;
  kind: FeedbackKind;
  target: FeedbackTarget;
  severity: FeedbackSeverity;
  title: string;
  body: string;
  evidence: string[];
  /** For a system signal: what it is, e.g. `loop.exhausted`. */
  code?: string;
  /** Groups records about the same thing into one item. */
  fingerprint: string;
  origin: FeedbackOrigin;
};

export type FeedbackResult =
  | { ok: true; fingerprint: string }
  | { ok: false; error: string };

/** A session's way to report feedback (the `feedback` tool). */
export type FeedbackPort = {
  report: (draft: FeedbackDraft) => FeedbackResult;
};
