/**
 * @file A node's result as it ended (specs/runtime/session-ends.md): one place
 *   that sets `end`, makes a failure's `error` its message and marks a
 *   transient kind, and that the engine's modules build ends through.
 */

import { homedir } from "node:os";

import { redact } from "../feedback/redact.ts";
import { endOf } from "../runtime/ends-legacy.ts";
import {
  END_KINDS,
  type EndKind,
  endFor,
  type SessionEnd,
} from "../runtime/ends.ts";
import type { NodeOutput, NodeResult } from "./types.ts";

export { endFor, endOf };
export type { EndKind, SessionEnd };

/**
 * The result as it ended: a failure's `error` is the end's message (what the
 * run summary lists), and a transient kind marks it `transient`.
 */
export const endedWith = (result: NodeResult, end: SessionEnd): NodeResult => ({
  ...result,
  end,
  ...(result.ok ? {} : { error: end.message }),
  ...(END_KINDS[end.kind].transient ? { transient: true as const } : {}),
});

/** The reason a run's signal is aborted with when its `limits.timeout` passed. */
export type RunTimedOut = { kind: "timed_out"; timeout?: string };

/** The reason a run's signal is aborted with when `timeout` passed. */
export const runTimedOut = (timeout: string | undefined): RunTimedOut =>
  timeout === undefined
    ? { kind: "timed_out" }
    : { kind: "timed_out", timeout };

const isTimedOut = (reason: unknown): reason is RunTimedOut =>
  typeof reason === "object" &&
  reason !== null &&
  "kind" in reason &&
  reason.kind === "timed_out";

/**
 * The end of a node its run's signal stopped: `timed_out` when the run's
 * timeout aborted it, `interrupted` otherwise.
 */
export const stoppedEnd = (
  signal: AbortSignal,
  detail?: string,
): SessionEnd => {
  const reason: unknown = signal.reason;
  if (!isTimedOut(reason)) return endFor("interrupted", {}, detail);
  const facts = reason.timeout === undefined ? {} : { timeout: reason.timeout };
  return endFor("timed_out", facts, detail);
};

/** A failure that ended as `end`, its message the output's summary. */
export const failedWith = (end: SessionEnd, output?: NodeOutput): NodeResult =>
  endedWith(
    { ok: false, output: output ?? { status: "fail", summary: end.message } },
    end,
  );

/**
 * The result with its end's detail scrubbed with the feedback redactor (the
 * run's `roots` and the home folder), as a session's is
 * (specs/runtime/session-ends.md), whichever node type set it.
 */
export const scrubbedEnd = (
  result: NodeResult,
  roots: readonly string[],
): NodeResult => {
  const { end } = result;
  if (end?.detail === undefined) return result;
  const detail = redact(end.detail, { roots, home: homedir() });
  return { ...result, end: { ...end, detail } };
};
