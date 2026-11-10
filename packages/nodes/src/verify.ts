/**
 * @file `verify:` (RFC-006): a program that must pass before a session's report
 *   is accepted. On a failure, the same session hears what failed and gets to
 *   fix it, a set number of times, and then the node fails. What goes back to
 *   the session stays small, as a session's cost grows with what it holds.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  endedWith,
  endOf,
  type ExecuteContext,
  heldTimeout,
  type NodeExecutor,
  type NodeResult,
  type SessionOutcome,
  type StepRun,
} from "@krapht/ork-core";
import { type Step, timeoutMs, type Verify } from "@krapht/ork-schema";

import { afterLateTurn, withUsageOf } from "./session-turns.ts";
import { keptFile, keptStem } from "./tool-output.ts";
import { OUTPUT_LIMIT } from "./tools.ts";

/** A setup that failed: no session started, so nothing was spent on it. */
export const beforeFailed = (ran: NodeResult): NodeResult => {
  const error = `its before step failed: ${ran.error ?? "no reason given"}`;
  // The node ends as its step did.
  return endedWith(
    {
      ok: false,
      output: { status: "fail", summary: error, before: ran.output },
    },
    endOf({ ...ran, ok: false }),
  );
};

/** With nothing to run a step, a report cannot be accepted. */
export const noSteps: NodeExecutor = () =>
  Promise.resolve({
    ok: false,
    output: {},
    error: "this run has no way to run a check",
  });

/** How much of a failed check's output a session is sent. */
const TAIL_LIMIT = 8 * 1024;

/**
 * A report a check stands between: `fail` and `changes_requested` accept
 * nothing.
 */
export const isAcceptance = (outcome: SessionOutcome): boolean =>
  outcome.report !== null &&
  outcome.report.status !== "fail" &&
  outcome.report.status !== "changes_requested";

/** Runs a step as a one-off tool node, in the node's checkout, as the node. */
export const runStep = async (
  tool: NodeExecutor,
  given: ExecuteContext,
  { timeout, ...fields }: Step,
  step: StepRun,
): Promise<NodeResult> => {
  const node = { type: "tool.shell" as const, ...fields };
  const context = { ...given, step };
  const ms = timeoutMs(timeout);
  if (ms === undefined) return tool({ ...context, node });
  const limit = new AbortController();
  const finished = new AbortController();
  let expired = false;
  const watch = async (): Promise<void> => {
    const elapsed = await heldTimeout(
      context.hold,
      ms,
      AbortSignal.any([context.signal, finished.signal]),
    );
    if (elapsed) {
      expired = true;
      limit.abort();
    }
  };
  void watch();
  const signal = AbortSignal.any([context.signal, limit.signal]);
  try {
    const result = await tool({ ...context, node, signal });
    return expired
      ? { ...result, ok: false, error: `timed out after ${String(timeout)}` }
      : result;
  } finally {
    finished.abort();
  }
};

const textOf = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

type Where = Pick<ExecuteContext, "runDir" | "id" | "round" | "step">;

/**
 * All a check printed on one stream. A node's output holds only the first 64
 * KiB, and what matters in a failure is usually at the end, so a longer one is
 * read back from the file it was kept in.
 */
const printed = (check: NodeResult, field: string, where: Where): string => {
  const shown = textOf(check.output[field]);
  if (shown.length <= OUTPUT_LIMIT) return shown;
  try {
    return readFileSync(keptFile(where, field), "utf8").trim();
  } catch {
    return shown;
  }
};

/** The end of what a check printed, and a file with the rest when there is more. */
const tailOf = (check: NodeResult, context: Where): string => {
  const said = [
    printed(check, "stdout", context),
    printed(check, "stderr", context),
  ]
    .filter(text => text !== "")
    .join("\n");
  if (said === "") return "It printed nothing.";
  if (said.length <= TAIL_LIMIT) return `\`\`\`\n${said}\n\`\`\``;
  mkdirSync(context.runDir, { recursive: true });
  const file = path.join(context.runDir, `${keptStem(context)}.txt`);
  writeFileSync(file, said);
  return `The end of what it printed, with all of it in ${file}:\n\n\`\`\`\n${said.slice(-TAIL_LIMIT)}\n\`\`\``;
};

/** What a session is told when the check on its report failed. */
export const checkFailedMessage = (check: NodeResult, context: Where): string =>
  `[ork] Your report was not accepted: the workflow's check failed (${check.error ?? "no reason given"}).\n\n${tailOf(check, context)}\n\nFix what it found, and end with a new structured report.`;

export type Checked = {
  outcome: SessionOutcome;
  /** The last check. */
  check: NodeResult;
  /** How many times the session was resumed to fix it. */
  resumes: number;
};

/**
 * Checks a report and, while a check fails and attempts and budget remain,
 * resumes the session. A resume that ends with a report that accepts nothing
 * ends it there, with the check still failed.
 */
export const checkReport = (given: {
  verify: Verify;
  first: SessionOutcome;
  signal: AbortSignal;
  check: () => Promise<NodeResult>;
  /** Resumes the session to fix this; `null` when it could not, or no budget. */
  resume: (
    outcome: SessionOutcome,
    check: NodeResult,
  ) => Promise<SessionOutcome | null>;
  /**
   * A turn for a message that came during a check that passed; `null` when none
   * came, or none can be spent. The check runs again after it, as the turn may
   * change the work.
   */
  late?: (outcome: SessionOutcome) => Promise<SessionOutcome | null>;
}): Promise<Checked> => {
  const attempts = given.verify.attempts ?? 1;
  const go = async (
    outcome: SessionOutcome,
    resumes: number,
    readLate: boolean,
  ): Promise<Checked> => {
    const check = given.signal.aborted
      ? ({
          ok: false,
          output: {},
          error: "the node was stopped before its check finished",
        } satisfies NodeResult)
      : await given.check();
    if (check.ok && !readLate && !given.signal.aborted) {
      const later = (await given.late?.(outcome)) ?? null;
      if (later !== null) {
        const merged = afterLateTurn(outcome, later);
        return isAcceptance(merged)
          ? go(merged, resumes, true)
          : { outcome: merged, check, resumes };
      }
    }
    if (check.ok || given.signal.aborted || resumes >= attempts) {
      return { outcome, check, resumes };
    }
    const later = await given.resume(outcome, check);
    if (later === null) return { outcome, check, resumes };
    const merged = withUsageOf(outcome, later);
    // Its last check failed, and a session can't report its way past that.
    return isAcceptance(merged)
      ? go(merged, resumes + 1, readLate)
      : { outcome: merged, check, resumes: resumes + 1 };
  };
  return go(given.first, 0, false);
};

/**
 * A node's result once its report has been checked. A later report that fails
 * says why.
 */
export const checkedResult = (
  result: NodeResult,
  { check, resumes }: Pick<Checked, "check" | "resumes">,
): NodeResult => {
  const verify = { exitCode: check.output["exitCode"], resumes };
  if (check.ok) {
    return { ...result, output: { ...result.output, verify } };
  }
  const reason = `its check failed: ${check.error ?? "no reason given"}`;
  const error = result.ok
    ? reason
    : `${reason} (then: ${result.error ?? "no report"})`;
  // A report the check refused ends as the check did; a later failure as itself.
  return endedWith(
    {
      ...result,
      ok: false,
      output: { ...result.output, status: "fail", summary: error, verify },
    },
    endOf(result.ok ? { ...check, ok: false } : result),
  );
};
