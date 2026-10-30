/**
 * @file Views over a run's stored events: the ownership tree with each node's
 *   state, runs, tokens and cost (`ork tree`), and whether a `running` run's
 *   process is still alive (`ork ps`).
 */

import type { NodeType } from "@krapht/ork-schema";

import type { RunEvent } from "../run/types.ts";
import type { RunRecord, StoredRunStatus } from "./types.ts";

export type NodeState = "waiting" | "running" | "ok" | "failed" | "skipped";

export type TreeNode = {
  id: string;
  type: NodeType;
  parent?: string;
  /** For a spawned worker, the declared node it is an instance of. */
  template?: string;
  state: NodeState;
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** The last result's one-line verdict fields. */
  output?: Record<string, unknown>;
  children: TreeNode[];
};

const blank = (id: string, type: NodeType, parent?: string): TreeNode => {
  const node: TreeNode = {
    id,
    type,
    state: "waiting",
    runs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    children: [],
  };
  if (parent !== undefined) node.parent = parent;
  return node;
};

/** A spawned worker's template: `<template>-<n>` of a declared node. */
const templateOf = (id: string, declared: Map<string, TreeNode>) => {
  const match = /^(?<base>.+)-\d+$/u.exec(id);
  const base = match?.groups?.["base"];
  return base !== undefined && declared.has(base) ? base : undefined;
};

/** Folds a run's events into its ownership tree; roots in declared order. */
export const runTree = (events: readonly RunEvent[]): TreeNode[] => {
  const nodes = new Map<string, TreeNode>();
  const declared = new Map<string, TreeNode>();
  for (const event of events) {
    if (event.type === "run.started") {
      for (const info of event.nodes) {
        // A resumed run starts again; what its nodes did so far stays.
        if (nodes.has(info.id)) continue;
        const node = blank(info.id, info.type, info.parent);
        nodes.set(info.id, node);
        declared.set(info.id, node);
      }
    } else if (event.type === "node.started") {
      let node = nodes.get(event.id);
      if (node === undefined) {
        node = blank(event.id, event.nodeType, event.owner);
        const template = templateOf(event.id, declared);
        if (template !== undefined) node.template = template;
        nodes.set(event.id, node);
      }
      node.state = "running";
      node.runs += 1;
    } else if (event.type === "node.finished") {
      const node = nodes.get(event.id);
      if (node === undefined) continue;
      node.state = event.ok ? "ok" : "failed";
      node.output = event.output;
      node.costUsd += event.usage?.costUsd ?? 0;
      node.inputTokens += event.usage?.inputTokens ?? 0;
      node.outputTokens += event.usage?.outputTokens ?? 0;
    } else if (event.type === "node.skipped") {
      const node = nodes.get(event.id);
      if (node !== undefined) node.state = "skipped";
    }
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const owner =
      node.parent === undefined ? undefined : nodes.get(node.parent);
    if (owner === undefined) roots.push(node);
    else owner.children.push(node);
  }
  return roots;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's process: alive, but not ours to signal.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** A run's status, with `crashed` for a `running` run whose process is gone. */
export const liveStatus = (run: RunRecord): StoredRunStatus | "crashed" =>
  run.status === "running" && !alive(run.pid) ? "crashed" : run.status;
