/**
 * @file What each node of a run is doing, and when it started and finished,
 *   folded from the stored events so nothing new has to be recorded. The tree
 *   (view.ts) folds the events alone; this needs when they were written, and
 *   keeps a screen's one-line answer to "what is it doing" in one place.
 */

import { lockWaitLine } from "../run/locks.ts";
import { slotWaitLine } from "../run/machine.ts";
import type { RuntimeEvent } from "../runtime/types.ts";
import type { StoredEvent } from "./types.ts";
import { runTree, type TreeNode } from "./view.ts";

export type NodeActivity = {
  /** What it's doing, or last did, in a line. */
  now?: string;
  startedAt?: string;
  /** When its last round finished; gone while another is running. */
  finishedAt?: string;
};

const LONGEST_LINE = 120;

/**
 * The fields of a tool's input that say what it's working on, best first. Only
 * these are shown, so what else a tool was given stays in the logs.
 */
const TARGETS = [
  "file_path",
  "notebook_path",
  "path",
  "url",
  "pattern",
  "query",
  "command",
];

const oneLine = (text: string): string => {
  const line = text.replaceAll(/\s+/gu, " ").trim();
  return line.length > LONGEST_LINE
    ? `${line.slice(0, LONGEST_LINE - 1)}…`
    : line;
};

const toolLine = ({
  name,
  input,
}: Extract<RuntimeEvent, { type: "tool.called" }>): string => {
  const target = TARGETS.map(field => input[field]).find(
    value => typeof value === "string" && value.trim() !== "",
  );
  if (typeof target !== "string") return name;
  // A shell tool's command starts with the tool: say it once.
  return oneLine(target.startsWith(`${name} `) ? target : `${name} ${target}`);
};

/** What a finished node said, or why it failed. */
const finishedNow = (
  ok: boolean,
  error: string | undefined,
  summary: unknown,
): string | undefined => {
  if (!ok) return error === undefined ? undefined : oneLine(error);
  return typeof summary === "string" && summary.trim() !== ""
    ? oneLine(summary)
    : undefined;
};

/** Each node's activity, by id; a node that never started has none. */
export const runActivity = (
  stored: readonly StoredEvent[],
): Map<string, NodeActivity> => {
  const nodes = new Map<string, NodeActivity>();
  const of = (id: string): NodeActivity => {
    const found = nodes.get(id);
    if (found !== undefined) return found;
    const fresh: NodeActivity = {};
    nodes.set(id, fresh);
    return fresh;
  };
  for (const { at, event } of stored) {
    if (event.type === "node.started") {
      const node = of(event.id);
      node.startedAt ??= at;
      delete node.finishedAt;
      delete node.now;
    } else if (event.type === "node.event") {
      if (event.event.type === "tool.called") {
        of(event.id).now = toolLine(event.event);
      }
    } else if (event.type === "slot.waiting") {
      of(event.id).now = oneLine(slotWaitLine(event.holders));
    } else if (event.type === "slot.taken") {
      delete of(event.id).now;
    } else if (event.type === "lock.waiting") {
      of(event.id).now = oneLine(lockWaitLine(event.lock, event.holders));
    } else if (event.type === "lock.taken") {
      delete of(event.id).now;
    } else if (event.type === "decision.opened") {
      of(event.node).now = oneLine(`Asked: ${event.question}`);
    } else if (event.type === "decision.answered") {
      of(event.node).now = oneLine(`Answered: ${event.answer}`);
    } else if (event.type === "decision.withdrawn") {
      delete of(event.node).now;
    } else if (event.type === "node.finished") {
      const node = of(event.id);
      node.finishedAt = at;
      const now = finishedNow(event.ok, event.error, event.output["summary"]);
      if (now === undefined) delete node.now;
      else node.now = now;
    }
  }
  return nodes;
};

/** The ownership tree, with what each node is doing and when it ran. */
export const activeTree = (stored: readonly StoredEvent[]): TreeNode[] => {
  const activity = runActivity(stored);
  const dress = (node: TreeNode): void => {
    Object.assign(node, activity.get(node.id));
    for (const child of node.children) dress(child);
  };
  const roots = runTree(stored.map(({ event }) => event));
  for (const root of roots) dress(root);
  return roots;
};
