/**
 * @file The run summary on the terminal: status, cost, what ran, what a resume
 *   kept, what was skipped and which failures an edge handled (G8, L42),
 *   branches to look at, why it did not succeed, and mail to nodes that never
 *   ran (L91).
 */

import { outputsText, type RunResult } from "@krapht/ork-core";

import { costOf } from "../output.ts";
import { chip, CHIP_LABELS } from "../term/chips.ts";
import type { Term } from "../term/mode.ts";
import { createView, styler } from "./view.ts";

/** How a run ended: its mark, and its chip's word and role when rich. */
const RUN_END: Record<
  RunResult["status"],
  { mark: string; ok: "ok" | "danger" | "warn"; label: string }
> = {
  succeeded: { mark: "✓", ok: "ok", label: CHIP_LABELS.ok },
  failed: { mark: "✗", ok: "danger", label: CHIP_LABELS.fail },
  budget_exhausted: { mark: "!", ok: "warn", label: CHIP_LABELS.wait },
  quota_exhausted: { mark: "!", ok: "warn", label: CHIP_LABELS.wait },
  timed_out: { mark: "!", ok: "warn", label: CHIP_LABELS.wait },
  interrupted: { mark: "!", ok: "warn", label: CHIP_LABELS.wait },
};

const MARK_COLOR = { ok: "green", danger: "red", warn: "yellow" } as const;

/** `1 failure handled`, `2 failures handled`. */
const failuresHandled = (count: number): string =>
  `${String(count)} ${count === 1 ? "failure" : "failures"} handled`;

/**
 * The workflow's declared outputs, one per key: a one-line value on the key's
 * line, a longer one under it; a cut value points at the stored full one.
 */
const outputLines = (
  result: RunResult,
  style: ReturnType<typeof styler>,
): string[] =>
  outputsText(result.outputs).flatMap(({ name, text, cut }) => {
    const key = style("bold", `${name}:`);
    const tail = cut
      ? [style("dim", `    … cut; full value: ork logs ${result.runId} --json`)]
      : [];
    if (text === "") return [`  ${key} ${style("dim", "(empty)")}`];
    if (!text.includes("\n")) return [`  ${key} ${text}`].concat(tail);
    const body = text.split("\n").map(line => `    ${line}`);
    return [`  ${key}`].concat(body, tail);
  });

/**
 * The run summary: status, cost, what ran, what was skipped and which failures
 * an edge handled, branches to look at, why, and mail to nodes that never ran.
 */
export const formatRunResult = (
  result: RunResult,
  term: Term = createView().term,
): string[] => {
  const style = styler(term);
  const end = RUN_END[result.status];
  // A chip says it in words; plain, the mark does, as it always did.
  const mark = term.rich
    ? chip(term, end.label, end.ok)
    : style(MARK_COLOR[end.ok], end.mark);
  // A resumed run's kept nodes have results, but did not run this time.
  const keptCount = result.kept ?? 0;
  const ran = result.nodes.filter(n => n.runs > 0).length - keptCount;
  const skipped = result.skipped ?? result.nodes.length - ran - keptCount;
  const handled = result.failuresHandled ?? 0;
  const lines = [
    "",
    `${mark} run ${result.runId} ${result.status.replace("_", " ")} ${style(
      "dim",
      `· ${costOf(result.costUsd, result.partial, result.tokens)} · ${String(ran)} ran, ${keptCount === 0 ? "" : `${String(keptCount)} kept, `}${String(skipped)} skipped${handled === 0 ? "" : `, ${failuresHandled(handled)}`}`,
    )}`,
    ...outputLines(result, style),
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
