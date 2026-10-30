/**
 * @file How runs read on the terminal: session events, node results, usage, run
 *   events with node prefixes, and the run summary.
 */

import type {
  RunEvent,
  RunResult,
  RuntimeEvent,
  SessionOutcome,
} from "@krapht/ork-core";

import { previewInput } from "../human.ts";
import { style } from "../output.ts";

export const STATUS_MARK: Record<string, string> = {
  pass: style("green", "✓"),
  done: style("green", "✓"),
  changes_requested: style("yellow", "!"),
  fail: style("red", "✗"),
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const indent = (text: string): string[] =>
  text
    .trimEnd()
    .split("\n")
    .map(line => `  ${line}`);

/** The usage line: cost, tokens, turns and time. */
export const formatUsage = ({ usage }: SessionOutcome): string =>
  style(
    "dim",
    [
      `$${usage.costUsd.toFixed(4)}`,
      `${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out (${String(usage.cacheReadTokens)} cached)`,
      `${String(usage.turns)} turns`,
      seconds(usage.durationMs),
    ].join(" · "),
  );

/** How a finished session reads on the terminal. */
export const formatOutcome = (
  nodeId: string,
  outcome: SessionOutcome,
): string[] => {
  const { report } = outcome;
  if (report === null) {
    return [
      `${style("red", "✗")} ${style("bold", nodeId)} ended without a report (${outcome.subtype})`,
      ...outcome.errors.map(e => `  ${style("red", e)}`),
      `  ${formatUsage(outcome)}`,
    ];
  }
  const lines = [
    `${STATUS_MARK[report.status] ?? "-"} ${style("bold", nodeId)} ${report.status}: ${report.summary}`,
  ];
  if (report.branch !== undefined) lines.push(`  branch: ${report.branch}`);
  for (const [name, file] of Object.entries(report.artifacts)) {
    lines.push(`  ${name}: ${file}`);
  }
  for (const [name, value] of Object.entries(report.fields)) {
    lines.push(`  ${name}: ${JSON.stringify(value)}`);
  }
  lines.push(`  ${formatUsage(outcome)}`);
  return lines;
};

/** The transcript lines for one event; tool names come from `tools`. */
export const formatEvent = (
  nodeId: string,
  event: RuntimeEvent,
  tools: Map<string, string>,
): string[] => {
  if (event.type === "session.started") {
    return [
      style("dim", `▸ ${nodeId} (${event.model}, session ${event.sessionId})`),
    ];
  }
  if (event.type === "assistant.text") return indent(event.text);
  if (event.type === "tool.called") {
    tools.set(event.id, event.name);
    return [style("dim", `  · ${previewInput(event.name, event.input)}`)];
  }
  if (event.type === "tool.result") {
    return event.isError
      ? [style("red", `  ✗ ${tools.get(event.id) ?? "tool"} failed`)]
      : [];
  }
  return formatOutcome(nodeId, event.outcome);
};

/** A one-line verdict for a finished node, by what its type outputs. */
export const nodeVerdict = (output: Record<string, unknown>): string => {
  const { status, summary, exitCode, choice, answeredBy, count } = output;
  if (typeof status === "string") {
    return typeof summary === "string" && summary !== ""
      ? `${status}: ${summary}`
      : status;
  }
  if (typeof exitCode === "number") return `exit ${String(exitCode)}`;
  if (typeof choice === "string") return `${choice} (${String(answeredBy)})`;
  if (typeof count === "number") return `${String(count)} ran`;
  return "done";
};

/** Transcript lines for one run event, prefixed with the node they are from. */
export const formatRunEvent = (
  event: RunEvent,
  width: number,
  tools: Map<string, string>,
): string[] => {
  const tag = (id: string) => style("cyan", `${id.padEnd(width)} │`);
  if (event.type === "run.started") {
    return [
      style(
        "dim",
        `▸ run ${event.runId} of ${event.workflow} (starts at ${event.entries.join(", ")})`,
      ),
    ];
  }
  if (event.type === "node.started") {
    const round = event.round > 1 ? ` (round ${String(event.round)})` : "";
    return [`${tag(event.id)} ${style("dim", `${event.nodeType}${round}`)}`];
  }
  if (event.type === "node.event") {
    const inner = event.event;
    if (inner.type === "session.finished") return [];
    if (inner.type === "session.started") {
      return [
        `${tag(event.id)} ${style("dim", `${inner.model}, session ${inner.sessionId}`)}`,
      ];
    }
    return formatEvent(event.id, event.event, tools).map(
      line => `${tag(event.id)} ${line.replace(/^ {2}/u, "")}`,
    );
  }
  if (event.type === "node.finished") {
    const mark = event.ok ? style("green", "✓") : style("red", "✗");
    const cost =
      event.usage === undefined
        ? ""
        : style("dim", ` · $${event.usage.costUsd.toFixed(4)}`);
    return [`${tag(event.id)} ${mark} ${nodeVerdict(event.output)}${cost}`];
  }
  if (event.type === "node.skipped") {
    return [`${tag(event.id)} ${style("dim", "- skipped")}`];
  }
  if (event.type === "loop.exhausted") {
    return [
      `${style(["yellow", "bold"], "!")} the loop ${event.from} -> ${event.to} used all ${String(event.maxRounds)} rounds`,
    ];
  }
  if (event.type === "edge.taken") return [];
  if (event.type === "worktree") {
    const detail = event.detail === undefined ? "" : ` (${event.detail})`;
    const line = `${event.action} ${event.branch}${detail}`;
    return [
      `${tag(event.id)} ${event.action === "conflict" ? style("yellow", `! ${line}`) : style("dim", `⎇ ${line}`)}`,
    ];
  }
  return formatRunResult(event.result);
};

const RUN_MARK: Record<RunResult["status"], string> = {
  succeeded: style("green", "✓"),
  failed: style("red", "✗"),
  budget_exhausted: style("yellow", "!"),
  interrupted: style("yellow", "!"),
};

/** The run summary: status, cost, what ran, branches to look at, and why. */
export const formatRunResult = (result: RunResult): string[] => {
  const ran = result.nodes.filter(n => n.runs > 0).length;
  const skipped = result.nodes.length - ran;
  const lines = [
    "",
    `${RUN_MARK[result.status]} run ${result.runId} ${result.status.replace("_", " ")} ${style(
      "dim",
      `· $${result.costUsd.toFixed(4)} · ${String(ran)} ran, ${String(skipped)} skipped`,
    )}`,
  ];
  for (const kept of result.worktrees) {
    lines.push(
      `  ${kept.id}: ${kept.branch} ${style("dim", `at ${kept.path} (${kept.reason})`)}`,
    );
  }
  for (const reason of result.reasons) lines.push(`  ${style("red", reason)}`);
  return lines;
};
