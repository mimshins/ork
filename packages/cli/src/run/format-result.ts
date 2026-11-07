/**
 * @file The run summary on the terminal: status, cost, what ran, what was
 *   skipped and which failures an edge handled (G8, L42), branches to look at,
 *   why it did not succeed, and mail to nodes that never ran (L91).
 */

import type { RunResult } from "@krapht/ork-core";

import { cost, style } from "../output.ts";

const RUN_MARK: Record<RunResult["status"], string> = {
  succeeded: style("green", "✓"),
  failed: style("red", "✗"),
  budget_exhausted: style("yellow", "!"),
  quota_exhausted: style("yellow", "!"),
  timed_out: style("yellow", "!"),
  interrupted: style("yellow", "!"),
};

/** `1 failure handled`, `2 failures handled`. */
const failuresHandled = (count: number): string =>
  `${String(count)} ${count === 1 ? "failure" : "failures"} handled`;

/**
 * The run summary: status, cost, what ran, what was skipped and which failures
 * an edge handled, branches to look at, why, and mail to nodes that never ran.
 */
export const formatRunResult = (result: RunResult): string[] => {
  const ran = result.nodes.filter(n => n.runs > 0).length;
  const skipped = result.skipped ?? result.nodes.length - ran;
  const handled = result.failuresHandled ?? 0;
  const lines = [
    "",
    `${RUN_MARK[result.status]} run ${result.runId} ${result.status.replace("_", " ")} ${style(
      "dim",
      `· ${cost(result.costUsd)} · ${String(ran)} ran, ${String(skipped)} skipped${handled === 0 ? "" : `, ${failuresHandled(handled)}`}`,
    )}`,
  ];
  for (const kept of result.worktrees) {
    lines.push(
      `  ${kept.id}: ${kept.branch ?? "detached"} ${style("dim", `at ${kept.path} (${kept.reason})`)}`,
    );
  }
  for (const reason of result.reasons) lines.push(`  ${style("red", reason)}`);
  for (const { node, messages } of result.unread ?? []) {
    lines.push(
      `  ${style(["yellow", "bold"], "warning")} ${node} never ran, so ${messages === 1 ? "1 message" : `${String(messages)} messages`} to it went unread`,
    );
  }
  return lines;
};
