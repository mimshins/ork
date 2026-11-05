/**
 * @file A finished session as a node's result: its report is the output, held
 *   to what the node declares (RFC-010).
 */

import {
  declaredProblem,
  type NodeResult,
  type SessionOutcome,
} from "@krapht/ork-core";

/** A finished session as a node result: its report is the node's output. */
export const resultOf = (
  outcome: SessionOutcome | null,
  declared?: Readonly<Record<string, unknown>>,
): NodeResult => {
  if (outcome === null) {
    return {
      ok: false,
      output: { status: "fail", summary: "the session ended without a result" },
      error: "the session ended without a result",
    };
  }
  const { report, usage } = outcome;
  if (report === null) {
    const reason = outcome.errors[0] ?? "no valid report";
    return {
      ok: false,
      output: { status: "fail", summary: reason, usage },
      usage,
      error: `ended without a report (${outcome.subtype}): ${reason}`,
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
    return {
      ok: false,
      // What it didn't declare isn't its output, so no condition can read it.
      output: {
        status: "fail",
        summary: problem,
        artifacts: report.artifacts,
        usage,
      },
      usage,
      error: problem,
      ...ran,
    };
  }
  const result: NodeResult = {
    ok: report.status !== "fail",
    output,
    usage,
    ...ran,
  };
  if (!result.ok) result.error = report.summary;
  return result;
};
