/**
 * @file A finished session as a node's result: its report is the output, held
 *   to what the node declares (RFC-010), and how it ended is its end kind
 *   (specs/runtime/session-ends.md).
 */

import {
  declaredProblem,
  endedWith,
  endFor,
  failedWith,
  type NodeResult,
  outcomeEnd,
  type SessionEnd,
  type SessionOutcome,
} from "@krapht/ork-core";

/** How a session with no report ended; a driver's `done` without one is not. */
const withoutReport = (outcome: SessionOutcome): SessionEnd => {
  const end = outcomeEnd(outcome);
  return end.kind === "done" || end.kind === "reported_failure"
    ? endFor("no_report", {}, end.detail)
    : end;
};

/** A finished session as a node result: its report is the node's output. */
export const resultOf = (
  outcome: SessionOutcome | null,
  declared?: Readonly<Record<string, unknown>>,
): NodeResult => {
  if (outcome === null) {
    return failedWith(
      endFor("driver_crashed", {}, "the session ended without a result"),
    );
  }
  const { report, usage } = outcome;
  if (report === null) {
    const end = withoutReport(outcome);
    return {
      ...failedWith(end, { status: "fail", summary: end.message, usage }),
      usage,
      sessionId: outcome.sessionId,
    };
  }
  const ran = { sessionId: outcome.sessionId };
  const output: Record<string, unknown> = {
    ...report.fields,
    status: report.status,
    summary: report.summary,
    artifacts: report.artifacts,
    usage,
  };
  if (report.branch !== undefined) output["branch"] = report.branch;
  const problem = declaredProblem(declared, output);
  if (problem !== null) {
    return endedWith(
      {
        ok: false,
        // What it didn't declare isn't its output, so no condition can read it.
        output: {
          status: "fail",
          summary: problem,
          artifacts: report.artifacts,
          usage,
          ...(report.branch === undefined ? {} : { branch: report.branch }),
        },
        usage,
        ...ran,
      },
      endFor("invalid_report", { reason: problem }),
    );
  }
  const ok = report.status !== "fail";
  return endedWith(
    { ok, output, usage, ...ran },
    endFor(ok ? "done" : "reported_failure"),
  );
};
