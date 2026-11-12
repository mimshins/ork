/**
 * @file How a session ended, as its adapter's decoder and the session runner
 *   settle it (specs/runtime/session-ends.md): a decoder names the signal only
 *   it can see (a turn cap, an exit code, a provider's error), and the report
 *   the session handed in decides the rest. The runner then writes the end in
 *   the node's numbers, its detail scrubbed with the feedback redactor. A
 *   session the driver could not run (or that was stopped, with what it had
 *   spent) ends as `driverFailure` says, one whose process died as
 *   `failureReason` explains, and one that reached its token cap as
 *   `tokenCapOutcome` says.
 */

import { homedir } from "node:os";
import path from "node:path";

import {
  countedTokens,
  type EndFacts,
  type EndKind,
  endFor,
  maskSecrets,
  type NodeReport,
  outcomeEnd,
  type RedactOptions,
  type RuntimeEvent,
  type SessionEnd,
  type SessionOutcome,
  type SessionSpec,
  type SessionUsage,
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
  const { usage } = outcome;
  const used: EndFacts = {
    ...facts,
    usedTokens: countedTokens(usage),
    // A cost of 0 is one the tool did not report (L280), not a spend.
    ...(usage.costUsd > 0 ? { usedUsd: usage.costUsd } : {}),
  };
  return { ...outcome, end: endFor(end.kind, used, end.detail, scrub) };
};

/** The node's numbers and the scrubbing a session's end is written with. */
export type EndScope = { facts: EndFacts; scrub?: RedactOptions };

/**
 * What a session's end is written with: the node's limits and program, and its
 * folder and the home folder taken out of the detail.
 */
export const scopeOf = (
  spec: SessionSpec,
  bin: string,
  env: Readonly<Record<string, string | undefined>>,
): EndScope => ({
  facts: {
    ...(spec.maxTurns === undefined ? {} : { maxTurns: spec.maxTurns }),
    ...(spec.budgetUsd === undefined ? {} : { budgetUsd: spec.budgetUsd }),
    ...(spec.budgetTokens === undefined
      ? {}
      : { budgetTokens: spec.budgetTokens }),
    program: path.basename(bin),
  },
  scrub: { roots: [spec.cwd], home: env["HOME"] ?? homedir() },
});

/**
 * The outcome of a session stopped once its counted tokens (RFC-015) reach
 * `budgetTokens`: `budget_limit`, with what it used so far; `undefined` under
 * the cap, or with none.
 */
export const tokenCapOutcome = (
  { budgetTokens }: EndFacts,
  usage: SessionUsage | undefined,
  sessionId: string,
): SessionOutcome | undefined =>
  budgetTokens === undefined ||
  usage === undefined ||
  countedTokens(usage) < budgetTokens
    ? undefined
    : {
        subtype: "error_max_budget_tokens",
        end: endFor("budget_limit"),
        sessionId,
        report: null,
        text: "",
        usage,
        errors: [`Reached the token budget (${String(budgetTokens)})`],
      };

const REASON_LIMIT = 500;

/** Noise a Node crash ends stderr with, or a stack frame: never the reason. */
const isNoise = (line: string): boolean =>
  /^Node\.js v\d/u.test(line) || /^\s+at /u.test(line);

/**
 * Why a process ended without a result: the last block of its stderr as one
 * masked, capped line (the reason reaches the terminal, which is not masked).
 */
export const failureReason = (
  name: string,
  stderr: string,
  code: number | null,
): string => {
  const block = stderr
    .split("\n")
    .filter(line => !isNoise(line))
    .join("\n")
    .split(/\n\s*\n/u)
    .map(text => text.trim().replaceAll(/\s*\n\s*/gu, " "))
    .findLast(text => text !== "");
  return block === undefined
    ? `${name} exited with code ${String(code)}`
    : maskSecrets(block).slice(0, REASON_LIMIT);
};

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

/** What a session had spent when it stopped, and the id it ran under. */
export type Spent = { usage: SessionUsage; sessionId: string };

const NOTHING_SPENT: Spent = {
  usage: {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
    durationMs: 0,
  },
  sessionId: "",
};

/**
 * A finished event for a session the driver could not run, ended as `kind` with
 * `message` (Ork's words or the tool's, masked) as its detail; a stopped one
 * keeps what it had `spent` (its tokens decoded so far, dollars $0).
 */
export const driverFailure = (
  message: string,
  kind: EndKind,
  scope: EndScope,
  spent: Spent = NOTHING_SPENT,
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
    sessionId: spent.sessionId,
    report: null,
    text: "",
    usage: spent.usage,
    errors: [message],
  },
});
