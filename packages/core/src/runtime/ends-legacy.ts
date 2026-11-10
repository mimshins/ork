/**
 * @file The legacy readers of how a node ended: a run stored before ends
 *   existed gets a kind from the text it kept (specs/runtime/session-ends.md),
 *   and the stored event is never rewritten.
 */

import { type EndKind, endFor, type SessionEnd } from "./ends.ts";
import type { SessionOutcome } from "./outcome.ts";

/**
 * Text Ork stored before ends existed, to a kind, in the plan's precedence:
 * interrupt, plan limit, budget, timeout, turn limit, provider error, missing
 * tool, failed command, crash. Frozen: old runs' text never changes, so this is
 * not the live provider classifier.
 */
const LEGACY_TEXT: readonly (readonly [EndKind, RegExp])[] = [
  [
    "interrupted",
    /\bstopped by the user\b|\bthe node was stopped\b|\bstopped while watching\b|\bwas interrupted\b|\bended interrupted\b|\bthe gate was withdrawn\b/u,
  ],
  [
    "plan_limit",
    /\bClaude plan's .* limit was reached\b|\bquota of \$[\d.]+ is spent\b|\bended quota_exhausted\b/u,
  ],
  [
    "budget_limit",
    /\(error_max_budget_usd\)|\bmaximum budget\b|\bnothing is left of the run's budget\b|\bbudget of \$[\d.]+ is spent\b|\bended budget_exhausted\b/u,
  ],
  [
    "timed_out",
    /\btimed out after\b|\bno one answered the gate\b|\btimeout of \S+ passed\b|\bended timed_out\b/u,
  ],
  ["turn_limit", /\(error_max_turns\)|\bmaximum number of turns\b/iu],
  [
    "context_too_long",
    /\bprompt is too long\b|\bcontext[ _](?:length|window)\b/iu,
  ],
  [
    "rate_limited",
    /\brate_limit_error\b|\brate.?limit(?:ed)?\b|\b(?:status|HTTP)\W{0,3}429\b/iu,
  ],
  [
    "out_of_credits",
    /\bcredit balance\b|\binsufficient[ _](?:credit|funds|quota)\b/iu,
  ],
  [
    "auth",
    /\bauthentication_error\b|\binvalid (?:x-)?api.?key\b|\bnot logged in\b|\/login\b|\b(?:status|HTTP)\W{0,3}401\b/iu,
  ],
  [
    "provider_unavailable",
    /\boverloaded(?:_error)?\b|\b(?:status|HTTP)\W{0,3}5\d\d\b|\bapi_error\b|\bECONNRESET\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bfetch failed\b/u,
  ],
  [
    "model_unavailable",
    /\bassistant message prefill\b|\bInvalid `signature` in `thinking` block\b|\bnot_found_error\b|\binvalid_request_error\b/u,
  ],
  [
    "tool_missing",
    /\bENOENT\b|\bcommand not found\b|\bno agent driver is ready\b/u,
  ],
  ["invalid_output", /\$ORK_OUTPUT\b|\bthe JSON result is\b/u],
  ["command_failed", /\bexited with \d+|^[\w.-]+ [\w-]+ failed: /u],
  ["driver_crashed", /\bthe session ended without a result\b/u],
];

const textKind = (text: string): EndKind | null =>
  LEGACY_TEXT.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

/** What `fieldProblems` writes (run/declared.ts). */
const DECLARED_PROBLEM =
  /\bis missing, expected\b|\bis .+, expected\b|^the result isn't a JSON object$/u;

const WITHOUT_REPORT = /^ended without a report \(([\w-]+)\): ([\s\S]*)$/u;

/** A driver's subtype, read with the session's error text. */
const subtypeKind = (subtype: string, text: string): EndKind => {
  if (subtype === "error_max_turns") return "turn_limit";
  if (subtype === "error_max_budget_usd") return "budget_limit";
  if (subtype === "error_max_structured_output_retries")
    return "invalid_report";
  const said = textKind(text);
  if (said !== null) return said;
  if (subtype === "error_driver") return "driver_crashed";
  return text === "no valid report" || subtype === "success"
    ? "no_report"
    : "unknown";
};

/** What `endOf` reads: a `node.finished` event, or a `NodeResult`. */
export type FinishedLike = {
  ok: boolean;
  output: Readonly<Record<string, unknown>>;
  error?: string;
  end?: SessionEnd;
};

/**
 * How a finished node ended: its own `end`, or, for an event stored before ends
 * existed, a kind read from its `error` text (`unknown` when nothing matches),
 * with that text as the detail.
 */
export const endOf = (finished: FinishedLike): SessionEnd => {
  if (finished.end !== undefined) return finished.end;
  if (finished.ok) return endFor("done");
  const error = finished.error ?? "";
  return endFor(legacyKind(error, finished.output), {}, error);
};

const legacyKind = (
  error: string,
  output: Readonly<Record<string, unknown>>,
): EndKind => {
  // Only a session's report puts `artifacts` in a failed output (resultOf).
  if ("artifacts" in output) {
    return DECLARED_PROBLEM.test(error) ? "invalid_report" : "reported_failure";
  }
  const without = WITHOUT_REPORT.exec(error);
  if (without !== null) {
    return subtypeKind(without[1] ?? "", without[2] ?? "");
  }
  return textKind(error) ?? "unknown";
};

/**
 * How a session ended: its `end`, or, for an outcome stored before ends existed
 * (or a driver that does not set one yet), one read from its subtype, report
 * and errors.
 */
export const outcomeEnd = (outcome: SessionOutcome): SessionEnd => {
  if (outcome.end !== undefined) return outcome.end;
  const { report } = outcome;
  if (report !== null && outcome.subtype === "success") {
    return endFor(report.status === "fail" ? "reported_failure" : "done");
  }
  const text = outcome.errors[0] ?? (report === null ? "no valid report" : "");
  return endFor(
    subtypeKind(outcome.subtype, text),
    {},
    outcome.errors.join("\n"),
  );
};
