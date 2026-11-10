/**
 * @file How a session ended, as its adapter's decoder and the session runner
 *   settle it (specs/runtime/session-ends.md): a decoder names the signal only
 *   it can see (a turn cap, an exit code, a provider's error), and the report
 *   the session handed in decides the rest. The runner then writes the end in
 *   the node's numbers, its detail scrubbed with the feedback redactor. A
 *   session the driver could not run ends as `driverFailure` says.
 */

import {
  type EndFacts,
  type EndKind,
  endFor,
  type NodeReport,
  outcomeEnd,
  type RedactOptions,
  type RuntimeEvent,
  type SessionEnd,
  type SessionOutcome,
} from "@krapht/ork-core";

import { classifyProviderError } from "./provider-errors.ts";

/** The end a report gives: done, a reported failure, or none handed in. */
export const reportEnd = (report: NodeReport | null): SessionEnd => {
  if (report === null) return endFor("no_report");
  return endFor(report.status === "fail" ? "reported_failure" : "done");
};

/**
 * A session's end: a report it handed in decides it (the node's result is that
 * report), then the decoder's `signal`, then `no_report`.
 */
export const sessionEnd = (
  signal: SessionEnd | null,
  report: NodeReport | null,
): SessionEnd =>
  report !== null || signal === null ? reportEnd(report) : signal;

/**
 * The end an error's text means: the provider classifier's kind, or `fallback`
 * when it recognizes nothing. The text is the detail either way.
 */
export const errorEnd = (
  text: string,
  fallback: EndKind = "unknown",
  status?: number,
): SessionEnd =>
  endFor(classifyProviderError(text, status)?.kind ?? fallback, {}, text);

/**
 * The outcome with its end settled: a report decides it, also one handed in
 * through Ork's `report` tool after the decoder's end said none; the message is
 * written with the node's numbers; the detail is scrubbed and capped. An
 * adapter whose decoder sets no end gets one read from the outcome.
 */
export const settleEnd = (
  outcome: SessionOutcome,
  facts: EndFacts,
  scrub?: RedactOptions,
): SessionOutcome => {
  const end =
    outcome.report === null
      ? (outcome.end ?? outcomeEnd(outcome))
      : reportEnd(outcome.report);
  return { ...outcome, end: endFor(end.kind, facts, end.detail, scrub) };
};

/** The node's numbers and the scrubbing a session's end is written with. */
export type EndScope = { facts: EndFacts; scrub?: RedactOptions };

/**
 * The kind of a failure to run the driver: its program missing, else what a
 * provider's words in it say, else a crash.
 */
export const failureKind = (error: unknown): EndKind => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "tool_missing";
  }
  const text = error instanceof Error ? error.message : String(error);
  if (/\bENOENT\b/u.test(text)) return "tool_missing";
  return classifyProviderError(text)?.kind ?? "driver_crashed";
};

/**
 * A finished event for a session the driver could not run, ended as `kind` with
 * `message` (Ork's words or the tool's, masked) as its detail.
 */
export const driverFailure = (
  message: string,
  kind: EndKind,
  scope: EndScope,
): RuntimeEvent => ({
  type: "session.finished",
  outcome: {
    subtype: "error_driver",
    end: endFor(
      kind,
      scope.facts,
      kind === "interrupted" ? undefined : message,
      scope.scrub,
    ),
    sessionId: "",
    report: null,
    text: "",
    usage: {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      turns: 0,
      durationMs: 0,
    },
    errors: [message],
  },
});
