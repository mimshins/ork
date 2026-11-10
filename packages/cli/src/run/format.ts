/**
 * @file How runs read on the terminal: session events, node results, usage, and
 *   run events with node prefixes; the run summary is `format-result.ts`'s.
 */

import {
  type AnsweredBy,
  type RunEvent,
  type RuntimeEvent,
  type SessionOutcome,
  outcomeEnd,
} from "@krapht/ork-core";

import { previewInput } from "../human.ts";
import { cost, style } from "../output.ts";
import { firstLine, formatBusEvent } from "./format-bus.ts";
import { endHeadline, endLines, formatFinished } from "./format-end.ts";
import { formatRunResult } from "./format-result.ts";

/** Who answered a decision, as the log says it. */
const ANSWERED_BY: Record<AnsweredBy, string> = {
  terminal: "terminal",
  decide: "ork decide",
  ui: "ork ui",
  owner: "its owner",
};

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
): string[] => {
  const { report } = outcome;
  if (report === null) {
    const end = outcomeEnd(outcome);
    return [
      `${style("red", "✗")} ${style("bold", nodeId)} ${endHeadline(end)}`,
      ...endLines(end, verbose),
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
  verbose = false,
): string[] => {
  if (event.type === "session.started") {
    const fork = event.fork === true ? ", a fork to answer a question" : "";
    return [
      style(
        "dim",
        `▸ ${nodeId} (${event.model}, session ${event.sessionId}${fork})`,
      ),
    ];
  }
  if (event.type === "assistant.text") return indent(event.text);
  if (event.type === "session.waiting") return indent(event.reason);
  if (event.type === "tool.called") {
    tools.set(event.id, event.name);
    return [style("dim", `  · ${previewInput(event.name, event.input)}`)];
  }
  if (event.type === "tool.result") {
    return event.isError
      ? [style("red", `  ✗ ${tools.get(event.id) ?? "tool"} failed`)]
      : [];
  }
  if (event.type === "plan.limit") {
    return event.status === "allowed"
      ? []
      : [
          style(
            "yellow",
            `  ! plan: ${event.window.replaceAll("_", " ")} limit ${event.status === "rejected" ? "reached" : "is close"}`,
          ),
        ];
  }
  return formatOutcome(nodeId, event.outcome, verbose);
};

const items = (count: number): string =>
  `${String(count)} ${count === 1 ? "item" : "items"}`;

/** Transcript lines for one run event, prefixed with the node they are from. */
export const formatRunEvent = (
  event: RunEvent,
  width: number,
  tools: Map<string, string>,
  /** Whether this terminal asks the questions of the run. */
  terminal = false,
  /** `--verbose`: a failed node's hint and its scrubbed detail. */
  verbose = false,
): string[] => {
  const tag = (id: string) => style("cyan", `${id.padEnd(width)} │`);
  if (event.type === "run.started") {
    return [
      style(
        "dim",
        `▸ run ${event.runId} of ${event.workflow} (starts at ${event.entries.join(", ")})`,
      ),
      ...(event.settings?.trigger === undefined
        ? []
        : [
            style(
              "dim",
              `  started by trigger ${event.settings.trigger}; untrusted inputs: ${(event.settings.untrusted ?? []).join(", ") || "none"}`,
            ),
          ]),
    ];
  }
  if (event.type === "node.started") {
    const round = event.round > 1 ? ` (round ${String(event.round)})` : "";
    const owner = event.owner === undefined ? "" : `, for ${event.owner}`;
    return [
      `${tag(event.id)} ${style("dim", `${event.nodeType}${round}${owner}`)}`,
    ];
  }
  if (event.type === "node.event") {
    const inner = event.event;
    if (inner.type === "session.finished") return [];
    // A fork answering a child's question (ADR-063): not the node's own words.
    const fork = inner.fork === true ? style("dim", "fork · ") : "";
    if (inner.type === "session.started") {
      const why = inner.fork === true ? ", to answer a question" : "";
      return [
        `${tag(event.id)} ${fork}${style("dim", `${inner.model}, session ${inner.sessionId}${why}`)}`,
      ];
    }
    return formatEvent(event.id, event.event, tools, verbose).map(
      line => `${tag(event.id)} ${fork}${line.replace(/^ {2}/u, "")}`,
    );
  }
  if (event.type === "node.finished") {
    return formatFinished(event, tag(event.id), verbose);
  }
  if (event.type === "node.skipped") {
    return [`${tag(event.id)} ${style("dim", "- skipped")}`];
  }
  if (event.type === "loop.exhausted") {
    return [
      `${style(["yellow", "bold"], "!")} the loop ${event.from} -> ${event.to} used all ${String(event.maxRounds)} rounds`,
    ];
  }
  if (event.type === "watch.started") {
    return [
      `${tag(event.id)} ${style("dim", `watching until ${event.until}, every ${event.every}`)}`,
    ];
  }
  if (event.type === "watch.changed") {
    return [
      `${tag(event.id)} ${style("dim", `look ${String(event.looks)}:`)} ${event.said}`,
    ];
  }
  if (event.type === "watch.ended") {
    return [
      `${tag(event.id)} ${style("dim", `${event.outcome} after ${String(event.looks)} looks`)}`,
    ];
  }
  if (event.type === "edge.taken") return [];
  if (event.type === "worktree") {
    const detail = event.detail === undefined ? "" : ` (${event.detail})`;
    // A removed worktree leaves its branch (ADR-020).
    const what =
      event.action === "removed" && event.branch !== undefined
        ? `worktree of ${event.branch} (branch kept)`
        : `${event.branch ?? event.path}${detail}`;
    const line = `${event.action} ${what}`;
    return [
      `${tag(event.id)} ${event.action === "conflict" ? style("yellow", `! ${line}`) : style("dim", `⎇ ${line}`)}`,
    ];
  }
  if (event.type === "decision.opened") {
    const what = event.kind === "permission" ? "asks to" : "asks:";
    const question =
      event.kind === "permission"
        ? event.question.replace(/^Allow /u, "run ").replace(/\?$/u, "")
        : event.question;
    // A question its owner answered at once has no one to wait on.
    const where =
      event.owner === undefined
        ? `decision ${event.decision}; ${terminal ? "answer here or with ork decide" : "ork decide"}`
        : `decision ${event.decision}, via ${event.owner}`;
    return [
      `${tag(event.node)} ${style(["yellow", "bold"], "?")} ${what} ${question} ${style("dim", `(${where})`)}`,
    ];
  }
  if (event.type === "decision.answered") {
    const by =
      event.by === "owner" && event.owner !== undefined
        ? event.owner
        : ANSWERED_BY[event.by];
    const said =
      event.note === undefined
        ? ""
        : ` · said: ${event.note.replaceAll(/\s+/gu, " ")}`;
    return [
      `${tag(event.node)} ${style("dim", `→ ${event.answer} (${by})${said}`)}`,
    ];
  }
  if (event.type === "decision.withdrawn") {
    return [`${tag(event.node)} ${style("dim", "→ question withdrawn")}`];
  }
  if (event.type === "run.command") {
    const node = event.node === undefined ? "" : ` --node ${event.node}`;
    return [
      style(["yellow", "bold"], `! ork ${event.command}${node} received`),
    ];
  }
  if (event.type === "node.held") {
    const at =
      event.at === "tool"
        ? "its tool call waits for ork continue"
        : "it starts after ork continue";
    return [`${tag(event.id)} ${style("yellow", `‖ paused: ${at}`)}`];
  }
  if (event.type === "node.released") {
    return [`${tag(event.id)} ${style("dim", "▸ continues")}`];
  }
  if (event.type === "each.listed") {
    const round = event.round > 1 ? ` (round ${String(event.round)})` : "";
    return [
      `${tag(event.node)} ${style("dim", `${items(event.count)}${round}`)}`,
    ];
  }
  if (event.type === "each.exceeded") {
    const over = `${items(event.count)}, over maxItems ${String(event.maxItems)}`;
    return [`${tag(event.node)} ${style("yellow", `! ${over}`)}`];
  }
  if (event.type === "run.finished") return formatRunResult(event.result);
  if (event.type === "run.resumed") {
    const [one] = event.kept;
    const kept =
      one === undefined
        ? "every node runs again"
        : event.kept.length === 1
          ? `${one} keeps its result`
          : `${event.kept.join(", ")} keep their results`;
    return ["", style("dim", `▸ resumed: ${kept}`)];
  }
  if (event.type === "feedback.recorded") {
    const { target, kind, title } = event.feedback;
    const line = style("dim", `✎ feedback (${target}, ${kind}): ${title}`);
    return [event.node === undefined ? line : `${tag(event.node)} ${line}`];
  }
  if (event.type === "user.message") {
    const note = event.delivered === "queued" ? " (for its next session)" : "";
    return [
      `${tag(event.node)} ${style(["magenta", "bold"], "you:")} ${firstLine(event.body)}${style("dim", note)}`,
    ];
  }
  return formatBusEvent(event).map(line => `${tag(event.node)} ${line}`);
};
