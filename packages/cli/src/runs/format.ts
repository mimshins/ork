/**
 * @file How stored runs read on the terminal: the `ork ps` table and the `ork
 *   tree` ownership tree with each node's state, tokens and cost, and what is
 *   paused (ADR-041).
 */

import {
  isItem,
  liveStatus,
  type LockWait,
  lockWaitLine,
  lockWaitsOf,
  type NodeState,
  type RunEvent,
  type RunRecord,
  runStatus,
  slotWaitsOf,
  type TreeNode,
} from "@krapht/ork-core";

import { cost, costOf, shortCount, style } from "../output.ts";
import { nodeVerdict } from "../run/verdict.ts";
import { statusChip } from "../term/chips.ts";
import { type Term, termOf } from "../term/mode.ts";
import { type Cell, type Column, header, table } from "../term/table.ts";

const STATUS_STYLE: Record<string, Parameters<typeof style>[0]> = {
  running: "cyan",
  paused: "yellow",
  succeeded: "green",
  failed: "red",
  crashed: "red",
  budget_exhausted: "yellow",
  quota_exhausted: "yellow",
  timed_out: "yellow",
  interrupted: "yellow",
};

/** `just now`, `5m ago`, `3h ago`, `2d ago`, then the date. */
export const ago = (iso: string, now: number = Date.now()): string => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h ago`;
  if (minutes < 7 * 24 * 60) {
    return `${String(Math.floor(minutes / (24 * 60)))}d ago`;
  }
  return iso.slice(0, 10);
};

/** `42s`, `3m12s`, `1h05m`. */
export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${String(s)}s`;
  if (s < 3600)
    return `${String(Math.floor(s / 60))}m${String(s % 60).padStart(2, "0")}s`;
  return `${String(Math.floor(s / 3600))}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

export { cost };

const dim = (s: string): string => style("dim", s);

/**
 * A run's status as `ork ps` reads it: for a running run, `waiting for <lock>,
 * held by <run>/<node>` with a node waiting for a lock, or `waiting for slot`
 * with a command waiting for a machine-wide slot; `events` are a running
 * run's.
 */
export const listedStatus = (
  run: RunRecord,
  events: readonly RunEvent[],
): string => {
  const status = runStatus(run, events);
  if (status !== "running") return status;
  const [lock] = lockWaitsOf(events);
  if (lock !== undefined) return lockWaitLine(lock.lock, lock.holders);
  return slotWaitsOf(events).length > 0 ? "waiting for slot" : status;
};

/**
 * The `ork ps` table; `withProject` adds each run's project. A called run's
 * cost is dimmed and says its caller's, whose cost already counts it.
 */
export const formatRuns = (
  runs: readonly RunRecord[],
  withProject: boolean,
  now: number = Date.now(),
  statusOf: (run: RunRecord) => string = liveStatus,
  term: Term = termOf(process.stdout),
): string[] => {
  if (runs.length === 0) return ["No runs."];
  const rows = runs.map(run => {
    const status = statusOf(run);
    const end = run.finishedAt === undefined ? now : Date.parse(run.finishedAt);
    return {
      id: run.id,
      workflow: run.workflow,
      status,
      when: `${ago(run.startedAt, now)} · ${duration(end - Date.parse(run.startedAt))}`,
      // A called run's spend is in its caller's too (L54): said, not added.
      cost:
        run.parent === undefined
          ? costOf(run.costUsd, run.partial, run.tokens)
          : `${costOf(run.costUsd, run.partial, run.tokens)} in ${run.parent}`,
      called: run.parent !== undefined,
      project: run.project,
    };
  });
  const rowOf = (r: (typeof rows)[number]): Cell[] => {
    const cells: Cell[] = [
      { text: r.id, look: s => style("bold", s) },
      { text: r.workflow },
      {
        text: r.status,
        chip: statusChip(r.status),
        look: s => style(STATUS_STYLE[r.status] ?? "reset", s),
      },
      { text: r.when, look: dim },
      r.called ? { text: r.cost, look: dim } : { text: r.cost },
    ];
    if (withProject) cells.push({ text: r.project, look: dim });
    return cells;
  };
  const heads = ["RUN", "WORKFLOW", "STATUS", "STARTED", "COST"].map(text =>
    header(text),
  );
  if (withProject) heads.push(header("PROJECT"));
  const columns: Column[] = [{}, { flex: true }, {}, {}, { align: "right" }];
  if (withProject) columns.push({ flex: true });
  return table(term, columns, [heads, ...rows.map(row => rowOf(row))]);
};

/** Marks are made when used, so `--plain` (set after load) is read. */
const STATE_MARK: Record<NodeState, () => string> = {
  waiting: () => style("dim", "·"),
  running: () => style("cyan", "●"),
  ok: () => style("green", "✓"),
  failed: () => style("red", "✗"),
  skipped: () => style("dim", "-"),
};

/** `950`, `12.3k`, `1.2M`. */
export const count = shortCount;

const stateText = (node: TreeNode): string => {
  if (node.state === "running") {
    return node.runs > 1 ? `running (round ${String(node.runs)})` : "running";
  }
  if (node.state === "ok" || node.state === "failed") {
    const verdict = nodeVerdict(node.output ?? {}, node.state === "ok");
    const line = verdict.length > 60 ? `${verdict.slice(0, 59)}…` : verdict;
    return node.runs > 1 ? `${line} (${String(node.runs)} runs)` : line;
  }
  return node.state;
};

/**
 * The ownership tree, one line per node, children under their owner. A node in
 * `waits` (a live run's `lockWaitsOf`) reads `waiting for <lock>`, an item
 * too.
 */
export const formatTree = (
  roots: readonly TreeNode[],
  now: number = Date.now(),
  waits: readonly LockWait[] = [],
): string[] => {
  const lines: { label: string; node: TreeNode }[] = [];
  const walk = (node: TreeNode, lead: string, branch: string) => {
    lines.push({ label: `${lead}${branch}${node.id}`, node });
    const next = lead + (branch === "├─ " ? "│  " : branch === "" ? "" : "   ");
    node.children.forEach((child, index) => {
      walk(child, next, index === node.children.length - 1 ? "└─ " : "├─ ");
    });
  };
  for (const root of roots) walk(root, "", "");
  const label = Math.max(...lines.map(l => l.label.length));
  const type = Math.max(...lines.map(l => l.node.type.length));
  return lines.map(({ label: text, node }) => {
    const usage =
      node.inputTokens + node.outputTokens === 0
        ? ""
        : style(
            "dim",
            `  ${count(node.inputTokens)} in / ${count(node.outputTokens)} out · ${cost(node.costUsd)}`,
          );
    const lock = waits.find(wait => wait.id === node.id)?.lock;
    const state =
      node.held === true
        ? `${style("yellow", "‖")} paused`
        : lock === undefined
          ? `${STATE_MARK[node.state]()} ${stateText(node)}`
          : `${STATE_MARK.waiting()} waiting for ${lock}`;
    const spent =
      isItem(node) && node.startedAt !== undefined
        ? style(
            "dim",
            `  ${duration((node.finishedAt === undefined ? now : Date.parse(node.finishedAt)) - Date.parse(node.startedAt))}`,
          )
        : "";
    return `${text.padEnd(label)}  ${style("dim", node.type.padEnd(type))}  ${state}${spent}${usage}`;
  });
};

/**
 * What `ork tree` prints: the run's header (its status as `ork ps` reads it)
 * and the tree. A finished run's lock waits are stale, so only a live run's
 * show; `events` are the run's, `roots` its nested tree.
 */
export const formatTreeView = (
  run: RunRecord,
  events: readonly RunEvent[],
  roots: readonly TreeNode[],
  now: number = Date.now(),
): string[] => {
  const waits = runStatus(run, events) === "running" ? lockWaitsOf(events) : [];
  return [
    `${style("bold", `run ${run.id}`)} ${dim(`of ${run.workflow} · ${listedStatus(run, events)} · ${cost(run.costUsd)}`)}`,
    ...formatTree(roots, now, waits),
  ];
};
