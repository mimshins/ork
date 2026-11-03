/**
 * @file Views over a run's stored events: the ownership tree with each node's
 *   state, runs, tokens and cost (`ork tree`), what is paused (ADR-041), and
 *   whether a `running` run's process is still alive (`ork ps`).
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
  /** Paused, and waiting at a hold point (ADR-041). */
  held?: true;
  /** The model its last session ran on. */
  model?: string;
  /** For a `workflow.call`, the run it last started (RFC-004). */
  calledRun?: string;
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
    } else if (event.type === "node.held") {
      const node = nodes.get(event.id);
      if (node !== undefined) node.held = true;
    } else if (event.type === "node.released") {
      const node = nodes.get(event.id);
      if (node !== undefined) delete node.held;
    } else if (event.type === "node.finished") {
      const node = nodes.get(event.id);
      if (node === undefined) continue;
      delete node.held;
      node.state = event.ok ? "ok" : "failed";
      node.output = event.output;
      node.costUsd += event.usage?.costUsd ?? 0;
      node.inputTokens += event.usage?.inputTokens ?? 0;
      node.outputTokens += event.usage?.outputTokens ?? 0;
    } else if (event.type === "node.skipped") {
      const node = nodes.get(event.id);
      if (node !== undefined) node.state = "skipped";
    } else if (event.type === "call.started") {
      const node = nodes.get(event.node);
      if (node !== undefined) node.calledRun = event.run;
    } else if (
      event.type === "node.event" &&
      event.event.type === "session.started"
    ) {
      const node = nodes.get(event.id);
      if (node !== undefined) node.model = event.event.model;
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

/** What is paused in a run: the whole run, and the nodes paused by name. */
export type Paused = { run: boolean; nodes: string[] };

/** Folds a run's `ork pause` and `ork continue` commands (ADR-041). */
export const pausedOf = (events: readonly RunEvent[]): Paused => {
  let run = false;
  const nodes = new Set<string>();
  for (const event of events) {
    if (event.type === "run.command" && event.command === "pause") {
      if (event.node === undefined) run = true;
      else nodes.add(event.node);
    } else if (event.type === "run.command" && event.command === "continue") {
      if (event.node === undefined) {
        run = false;
        nodes.clear();
      } else {
        nodes.delete(event.node);
      }
    } else if (event.type === "run.started" || event.type === "run.finished") {
      // A resumed run starts unpaused; a finished one has nothing paused.
      run = false;
      nodes.clear();
    }
  }
  return { run, nodes: [...nodes] };
};

/** Whether a process is running: ours, or another user's (alive, not ours). */
export const processAlive = (pid: number): boolean => {
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
  run.status === "running" && !processAlive(run.pid) ? "crashed" : run.status;

/** `liveStatus`, with `paused` for a running run paused as a whole. */
export const runStatus = (
  run: RunRecord,
  events: readonly RunEvent[],
): StoredRunStatus | "crashed" | "paused" => {
  const status = liveStatus(run);
  return status === "running" && pausedOf(events).run ? "paused" : status;
};
