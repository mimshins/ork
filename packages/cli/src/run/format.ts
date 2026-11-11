/**
 * @file How runs read on the terminal: session events and run events with node
 *   chips or prefixes; the node result is `format-outcome.ts`'s, a tool call
 *   `format-tool.ts`'s and the run summary `format-result.ts`'s.
 */

import {
  type AnsweredBy,
  type RunEvent,
  type RuntimeEvent,
  slotWaitLine,
} from "@krapht/ork-core";

import { chip, CHIP_LABELS, nodeChip } from "../term/chips.ts";
import { widthOf } from "../term/layout.ts";
import { firstLine, formatBusEvent } from "./format-bus.ts";
import { formatFinished } from "./format-end.ts";
import { formatOutcome } from "./format-outcome.ts";
import { formatRunResult } from "./format-result.ts";
import { indent, toolLines, wrapped } from "./format-tool.ts";
import { createView, styler, type View } from "./view.ts";

export { createView, indent };

/** A line's 2-column indent, after any style codes that open it. */
// oxlint-disable-next-line no-control-regex -- matches a style's escape codes
const INDENT = /^((?:\u001B\[[0-9;]*m)*) {2}/u;

/** Who answered a decision, as the log says it. */
export const ANSWERED_BY: Record<AnsweredBy, string> = {
  terminal: "terminal",
  decide: "ork decide",
  ui: "ork ui",
  owner: "its owner",
};

/** The transcript lines for one event; tool names come from `tools`. */
export const formatEvent = (
  nodeId: string,
  event: RuntimeEvent,
  tools: Map<string, string>,
  verbose = false,
  view: View = createView(),
  /** Columns the lines may take, rich: wrapped and cut to it. */
  room: number = view.term.width - 1,
): string[] => {
  const { term } = view;
  const style = styler(term);
  if (event.type === "session.started") {
    const fork = event.fork === true ? ", a fork to answer a question" : "";
    return [
      style(
        "dim",
        `▸ ${nodeId} (${event.model}, session ${event.sessionId}${fork})`,
      ),
    ];
  }
  if (event.type === "assistant.text") {
    return term.rich ? wrapped(event.text, room) : indent(event.text);
  }
  if (event.type === "session.waiting") return indent(event.reason);
  if (event.type === "tool.called") {
    tools.set(event.id, event.name);
    return toolLines(event.name, event.input, view, room, verbose, nodeId);
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
  return formatOutcome(nodeId, event.outcome, verbose, term);
};

const items = (count: number): string =>
  `${String(count)} ${count === 1 ? "item" : "items"}`;

/** A `once: true` check that did not run, and the pass it stands on. */
const skippedLine = ({
  check,
  at,
  who,
}: Extract<RunEvent, { type: "verify.skipped" }>): string =>
  `${check}: already passed on these files · ${at} · ${who}`;

/** Transcript lines for one run event, prefixed with the node they are from. */
export const formatRunEvent = (
  event: RunEvent,
  width: number,
  tools: Map<string, string>,
  /** Whether this terminal asks the questions of the run. */
  terminal = false,
  /** `--verbose`: a failed node's hint and its scrubbed detail. */
  verbose = false,
  view: View = createView(),
): string[] => {
  const { term } = view;
  const style = styler(term);
  // Rich, a node's chip leads its first line and spaces its other lines.
  const tag = (id: string) =>
    term.rich
      ? `${nodeChip(term, id)}${" ".repeat(Math.max(0, width - id.length))}`
      : style("cyan", `${id.padEnd(width)} │`);
  const blank = (id: string) =>
    term.rich ? " ".repeat(widthOf(tag(id))) : tag(id);
  const under = (id: string, lines: string[]): string[] =>
    lines.map((line, i) => `${i === 0 ? tag(id) : blank(id)} ${line}`);
  if (event.type === "run.started") {
    const starts = `starts at ${event.entries.join(", ")}`;
    return [
      term.rich
        ? `${chip(term, CHIP_LABELS.run, "accent")} run ${style("bold", event.runId)} of ${event.workflow} ${style("dim", starts)}`
        : style("dim", `▸ run ${event.runId} of ${event.workflow} (${starts})`),
      ...(event.settings?.trigger === undefined
        ? []
        : [
            style(
              "dim",
              `  started by trigger ${event.settings.trigger}; untrusted inputs: ${(event.settings.untrusted ?? []).join(", ") || "none"}`,
            ),
          ]),
      // A block of its own: the transcript starts after a blank line.
      ...(term.rich ? [""] : []),
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
    // The tag's width and its space are not the body's; its 2-column indent is.
    // A fork's `fork · ` prefix (7 columns) is on each line too.
    const room =
      term.width -
      widthOf(tag(event.id)) -
      1 +
      2 -
      (inner.fork === true ? 7 : 0);
    return under(
      event.id,
      formatEvent(event.id, event.event, tools, verbose, view, room).map(
        line => `${fork}${line.replace(INDENT, "$1")}`,
      ),
    );
  }
  if (event.type === "node.finished") {
    return formatFinished(event, tag(event.id), verbose, term, blank(event.id));
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
    if (event.action !== "removed") view.roots.set(event.id, event.path);
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
      `${tag(event.node)} ${term.rich ? chip(term, CHIP_LABELS.ask, "accent") : style(["yellow", "bold"], "?")} ${what} ${question} ${style("dim", `(${where})`)}`,
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
  if (event.type === "slot.waiting") {
    return [
      `${tag(event.id)} ${style("yellow", `‖ ${slotWaitLine(event.holders)}`)}`,
    ];
  }
  if (event.type === "slot.taken") {
    return [`${tag(event.id)} ${style("dim", "▸ got a check slot")}`];
  }
  if (event.type === "verify.skipped") {
    return [`${tag(event.id)} ${style("dim", `✓ ${skippedLine(event)}`)}`];
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
  if (event.type === "run.finished") return formatRunResult(event.result, term);
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
  return under(event.node, formatBusEvent(event, term));
};
