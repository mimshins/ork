/**
 * @file The feedback a node's end files (specs/feedback.md,
 *   specs/runtime/session-ends.md), by who should act on it: Ork's own bug, the
 *   workflow's, or the agent's context. An account's, a provider's or the
 *   user's end is a setup hint on the screen, not feedback.
 */

import { END_KINDS, type EndKind, type SessionEnd } from "../runtime/ends.ts";
import type {
  FeedbackKind,
  FeedbackSeverity,
  FeedbackTarget,
} from "./types.ts";

/** A signal before its origin is filled in. */
export type Signal = {
  code: string;
  kind: FeedbackKind;
  target: FeedbackTarget;
  severity: FeedbackSeverity;
  title: string;
  body: string;
  evidence?: string[];
};

/**
 * Ends that are a node's work saying no, not a problem to act on: an agent that
 * reports `fail`, a command that exits non-zero. Neither is filed.
 */
const ANSWERS: ReadonlySet<EndKind> = new Set([
  "reported_failure",
  "command_failed",
]);

/**
 * The feedback a node's end files, by who should act on it: Ork's own bug (with
 * the scrubbed detail, so a rule can be added), the workflow's, or the agent's
 * context. An account's, a provider's or the user's is not feedback.
 */
export const endSignal = (node: string, end: SessionEnd): Signal | null => {
  const info = END_KINDS[end.kind];
  if (ANSWERS.has(end.kind)) return null;
  const base = {
    code: `end.${end.kind}`,
    title: `${node} ${end.message}`,
    body: info.hint,
    ...(end.detail === undefined ? {} : { evidence: [end.detail] }),
  };
  if (info.actor === "ork") {
    return { ...base, kind: "bug", target: "ork", severity: "medium" };
  }
  if (info.actor === "workflow") {
    return { ...base, kind: "workflow", target: "workflow", severity: "low" };
  }
  return info.actor === "agent"
    ? { ...base, kind: "context-gap", target: "workflow", severity: "low" }
    : null;
};
