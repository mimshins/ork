/**
 * @file How a finished session reads on the terminal: its report or its end,
 *   the branch, artifacts and fields, and the usage line.
 */

import { type SessionOutcome, outcomeEnd } from "@krapht/ork-core";

import { cost } from "../output.ts";
import type { Term } from "../term/mode.ts";
import { endHeadline, endLines } from "./format-end.ts";
import { createView, styler } from "./view.ts";

const STATUS_MARK: Record<
  string,
  { mark: string; color: "green" | "yellow" | "red" }
> = {
  pass: { mark: "✓", color: "green" },
  done: { mark: "✓", color: "green" },
  changes_requested: { mark: "!", color: "yellow" },
  fail: { mark: "✗", color: "red" },
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** The usage line: cost, tokens, turns and time. */
export const formatUsage = (
  { usage }: SessionOutcome,
  term: Term = createView().term,
): string =>
  styler(term)(
    "dim",
    [
      cost(usage.costUsd),
      `${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out (${String(usage.cacheReadTokens)} cached)`,
      `${String(usage.turns)} turns`,
      seconds(usage.durationMs),
    ].join(" · "),
  );

/** How a finished session reads on the terminal. */
export const formatOutcome = (
  nodeId: string,
  outcome: SessionOutcome,
  verbose = false,
  term: Term = createView().term,
): string[] => {
  const style = styler(term);
  const { report } = outcome;
  if (report === null) {
    const end = outcomeEnd(outcome);
    return [
      `${style("red", "✗")} ${style("bold", nodeId)} ${endHeadline(end)}`,
      ...endLines(end, verbose, term),
      `  ${formatUsage(outcome, term)}`,
    ];
  }
  const shown = STATUS_MARK[report.status];
  const lines = [
    `${shown === undefined ? "-" : style(shown.color, shown.mark)} ${style("bold", nodeId)} ${report.status}: ${report.summary}`,
  ];
  if (report.branch !== undefined) lines.push(`  branch: ${report.branch}`);
  for (const [name, file] of Object.entries(report.artifacts)) {
    lines.push(`  ${name}: ${file}`);
  }
  for (const [name, value] of Object.entries(report.fields)) {
    lines.push(`  ${name}: ${JSON.stringify(value)}`);
  }
  lines.push(`  ${formatUsage(outcome, term)}`);
  return lines;
};
