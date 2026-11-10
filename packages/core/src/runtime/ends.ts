/**
 * @file How a node ended, as one of a closed set of kinds (specs/runtime/
 *   session-ends.md): the registry that gives each kind its label, Ork's own
 *   message, who should act and what to do, and `endFor`, which builds an end
 *   with its raw detail scrubbed and capped. ends-legacy.ts reads one from runs
 *   stored before ends existed.
 */

import { type RedactOptions, redact } from "../feedback/redact.ts";
import { maskSecrets } from "../store/mask.ts";

/** Every way a node can end; a closed set, each with a `END_KINDS` entry. */
export const END_KIND_IDS = [
  "done",
  "reported_failure",
  "no_report",
  "invalid_report",
  "turn_limit",
  "budget_limit",
  "timed_out",
  "context_too_long",
  "plan_limit",
  "rate_limited",
  "provider_unavailable",
  "auth",
  "out_of_credits",
  "model_unavailable",
  "interrupted",
  "tool_missing",
  "command_failed",
  "invalid_output",
  "invalid_node",
  "driver_crashed",
  "unknown",
] as const;

export type EndKind = (typeof END_KIND_IDS)[number];

/** Who should act on an end; feedback files by it. */
export type EndActor =
  | "agent"
  | "workflow"
  | "account"
  | "provider"
  | "user"
  | "ork";

/** How a node ended: its kind, Ork's sentence, and the raw text behind it. */
export type SessionEnd = {
  kind: EndKind;
  /** Ork's own words, with the node's numbers; never the provider's. */
  message: string;
  /** The raw provider or tool text, scrubbed and capped; shown on request. */
  detail?: string;
};

/** The numbers and names a kind's message may use. */
export type EndFacts = {
  maxTurns?: number;
  budgetUsd?: number;
  /** As written, e.g. `10m`. */
  timeout?: string;
  /** A plan's window, e.g. `five_hour`. */
  window?: string;
  program?: string;
  exitCode?: number;
  /** Ork's own words on what was wrong, e.g. a declared-output problem. */
  reason?: string;
};

export type EndKindInfo = {
  /** A short badge, e.g. `Turn limit`. */
  label: string;
  /** Ork's sentence, without the node's name: "reached its turn limit (8)". */
  message: (facts: EndFacts) => string;
  /** `null` for `done`: no one needs to act. */
  actor: EndActor | null;
  /** Another try may not fail (`NodeResult.transient`). */
  transient: boolean;
  /** It stops the run, not only the node (RFC-007). */
  stopsRun: boolean;
  /** What to do about it. */
  hint: string;
  /** Its section in `END_DOCS`. */
  docsAnchor: string;
};

/** The guide that lists every kind (plan task 13 writes it). */
export const END_DOCS = "docs/guides/why-a-node-stopped.md";

/** The most of a detail kept, in characters. */
export const END_DETAIL_LIMIT = 4096;

const RETRY = "This may pass: `ork resume` tries again.";

const usd = (n: number): string =>
  `$${Number.isInteger(n) ? String(n) : n.toFixed(2)}`;

const paren = (value: string | undefined): string =>
  value === undefined ? "" : ` (${value})`;

const colon = (reason: string | undefined): string =>
  reason === undefined ? "" : `: ${reason}`;

const info = (
  label: string,
  actor: EndActor | null,
  message: (facts: EndFacts) => string,
  hint: string,
  flags: { transient?: boolean; stopsRun?: boolean } = {},
): EndKindInfo => ({
  label,
  message,
  actor,
  transient: flags.transient ?? false,
  stopsRun: flags.stopsRun ?? false,
  hint,
  docsAnchor: label.toLowerCase().replaceAll(" ", "-"),
});

/** Each kind's label, message, actor, flags, hint and docs anchor. */
export const END_KINDS: Readonly<Record<EndKind, EndKindInfo>> = {
  done: info("Done", null, () => "finished", ""),
  reported_failure: info(
    "Reported failure",
    "agent",
    () => "reported that it failed",
    "Read its summary, fix what it names, and run it again.",
  ),
  no_report: info(
    "No report",
    "agent",
    () => "ended without handing in a report",
    "Check that its brief says what to report; its session is in the Logs panel.",
  ),
  invalid_report: info(
    "Invalid report",
    "agent",
    f => `handed in a report that breaks its declared output${colon(f.reason)}`,
    "Check that its brief asks for every field its `output.schema` declares.",
  ),
  turn_limit: info(
    "Turn limit",
    "workflow",
    f =>
      `reached its turn limit${paren(f.maxTurns === undefined ? undefined : String(f.maxTurns))}`,
    "Raise its `maxTurns`, or give it a smaller task.",
  ),
  budget_limit: info(
    "Budget limit",
    "workflow",
    f =>
      `reached its budget${paren(f.budgetUsd === undefined ? undefined : usd(f.budgetUsd))}`,
    "Raise `budgetUsd` on the node or `limits.budgetUsd` on the workflow, then `ork resume`.",
  ),
  timed_out: info(
    "Timed out",
    "workflow",
    f => `reached its timeout${paren(f.timeout)}`,
    "Raise its `timeout`, or give it a smaller task.",
  ),
  context_too_long: info(
    "Context too long",
    "workflow",
    () => "outgrew its model's context",
    "Give it a smaller task or less context, or a model with a larger context.",
  ),
  plan_limit: info(
    "Plan limit",
    "account",
    f => `ran into a usage limit${paren(f.window?.replaceAll("_", " "))}`,
    `Wait until the limit resets. ${RETRY}`,
    { transient: true, stopsRun: true },
  ),
  rate_limited: info(
    "Rate limited",
    "provider",
    () => "was asked by its provider to slow down",
    RETRY,
    { transient: true },
  ),
  provider_unavailable: info(
    "Provider unavailable",
    "provider",
    () => "could not reach its provider, or the provider was overloaded",
    RETRY,
    { transient: true },
  ),
  auth: info(
    "Not signed in",
    "account",
    () => "could not sign in to its provider",
    "Sign in to the driver's tool again (`ork doctor` says how), then `ork resume`.",
  ),
  out_of_credits: info(
    "Out of credits",
    "account",
    () => "found no credit left on its account",
    "Add credit to the account, or use another, then `ork resume`.",
  ),
  model_unavailable: info(
    "Model unavailable",
    "account",
    () => "asked for something its model or provider can't serve",
    "Use another model or driver for the node.",
  ),
  interrupted: info(
    "Interrupted",
    "user",
    () => "was stopped",
    "`ork resume` goes on from where it stopped.",
  ),
  tool_missing: info(
    "Tool missing",
    "account",
    f => `could not start ${f.program ?? "its program"}: it isn't installed`,
    "Install it (`ork doctor` checks the drivers), then `ork resume`.",
  ),
  command_failed: info(
    "Command failed",
    "workflow",
    f =>
      `${f.program ?? "its command"} exited with ${f.exitCode === undefined ? "an error" : String(f.exitCode)}`,
    "Its output is under Details.",
  ),
  invalid_output: info(
    "Invalid output",
    "workflow",
    f => `gave JSON that breaks its declared output${colon(f.reason)}`,
    "Make the command print what its `output.schema` declares.",
  ),
  invalid_node: info(
    "Invalid node",
    "workflow",
    f => `could not start${colon(f.reason)}`,
    "Fix the node in the workflow file (`ork validate` checks it).",
  ),
  driver_crashed: info(
    "Driver crashed",
    "ork",
    () => "lost its driver in a way Ork can't read",
    "Its last output is under Details; Ork files it as a bug.",
  ),
  unknown: info(
    "Unknown",
    "ork",
    () => "ended for a reason Ork doesn't recognize",
    "Its detail is under Details; Ork files it as a bug, so a rule can be added.",
  ),
};

/**
 * An end of `kind`, its message from `facts`. The detail is scrubbed (with the
 * feedback redactor when `scrub` is given, secrets masked always) and capped.
 */
export const endFor = (
  kind: EndKind,
  facts: EndFacts = {},
  detail?: string,
  scrub?: RedactOptions,
): SessionEnd => {
  const end: SessionEnd = { kind, message: END_KINDS[kind].message(facts) };
  if (detail === undefined || detail.trim() === "") return end;
  const clean =
    scrub === undefined ? maskSecrets(detail) : redact(detail, scrub);
  // shortcut: caps UTF-16 units, not bytes; non-ASCII detail may pass 4 KiB.
  end.detail =
    clean.length > END_DETAIL_LIMIT
      ? `${clean.slice(0, END_DETAIL_LIMIT - 1)}…`
      : clean;
  return end;
};
