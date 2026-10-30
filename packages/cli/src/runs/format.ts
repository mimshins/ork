/**
 * @file How stored runs read on the terminal: the `ork ps` table and the `ork
 *   tree` ownership tree with each node's state, tokens and cost.
 */

import {
  liveStatus,
  type NodeState,
  type RunRecord,
  type TreeNode,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { nodeVerdict } from "../run/format.ts";

const STATUS_STYLE: Record<string, Parameters<typeof style>[0]> = {
  running: "cyan",
  succeeded: "green",
  failed: "red",
  crashed: "red",
  budget_exhausted: "yellow",
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

export const cost = (usd: number): string => `$${usd.toFixed(4)}`;

/** The `ork ps` table; `withProject` adds each run's project. */
export const formatRuns = (
  runs: readonly RunRecord[],
  withProject: boolean,
  now: number = Date.now(),
): string[] => {
  if (runs.length === 0) return ["No runs."];
  const rows = runs.map(run => {
    const status = liveStatus(run);
    const end = run.finishedAt === undefined ? now : Date.parse(run.finishedAt);
    return {
      id: run.id,
      workflow: run.workflow,
      status,
      when: `${ago(run.startedAt, now)} · ${duration(end - Date.parse(run.startedAt))}`,
      cost: cost(run.costUsd),
      project: run.project,
    };
  });
  const width = (pick: (r: (typeof rows)[number]) => string, title: string) =>
    Math.max(title.length, ...rows.map(r => pick(r).length));
  const w = {
    id: width(r => r.id, "RUN"),
    workflow: width(r => r.workflow, "WORKFLOW"),
    status: width(r => r.status, "STATUS"),
    when: width(r => r.when, "STARTED"),
    cost: width(r => r.cost, "COST"),
  };
  const header = [
    "RUN".padEnd(w.id),
    "WORKFLOW".padEnd(w.workflow),
    "STATUS".padEnd(w.status),
    "STARTED".padEnd(w.when),
    "COST".padStart(w.cost),
    ...(withProject ? ["PROJECT"] : []),
  ].join("  ");
  return [
    style("dim", header),
    ...rows.map(r =>
      [
        style("bold", r.id.padEnd(w.id)),
        r.workflow.padEnd(w.workflow),
        style(STATUS_STYLE[r.status] ?? "reset", r.status.padEnd(w.status)),
        style("dim", r.when.padEnd(w.when)),
        r.cost.padStart(w.cost),
        ...(withProject ? [style("dim", r.project)] : []),
      ].join("  "),
    ),
  ];
};

const STATE_MARK: Record<NodeState, string> = {
  waiting: style("dim", "·"),
  running: style("cyan", "●"),
  ok: style("green", "✓"),
  failed: style("red", "✗"),
  skipped: style("dim", "-"),
};

/** `950`, `12.3k`, `1.2M`. */
export const count = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
};

const stateText = (node: TreeNode): string => {
  if (node.state === "running") {
    return node.runs > 1 ? `running (round ${String(node.runs)})` : "running";
  }
  if (node.state === "ok" || node.state === "failed") {
    const verdict = nodeVerdict(node.output ?? {});
    const line = verdict.length > 60 ? `${verdict.slice(0, 59)}…` : verdict;
    return node.runs > 1 ? `${line} (${String(node.runs)} runs)` : line;
  }
  return node.state;
};

/** The ownership tree, one line per node, children under their owner. */
export const formatTree = (roots: readonly TreeNode[]): string[] => {
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
    return `${text.padEnd(label)}  ${style("dim", node.type.padEnd(type))}  ${STATE_MARK[node.state]} ${stateText(node)}${usage}`;
  });
};
