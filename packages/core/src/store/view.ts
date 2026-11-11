/**
 * @file Views over a run's stored events: the ownership tree with each node's
 *   state, runs, tokens and cost (`ork tree`), what is paused (ADR-041), and
 *   whether a `running` run's process is still its own (`ork ps`).
 */

import type { NodeType } from "@krapht/ork-schema";

import type { RunEvent } from "../run/types.ts";
import { isItem } from "./nest-items.ts";
import { type ProcessStartReader, runProcessAlive } from "./process-age.ts";
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
  /** What its `watch:` is waiting for, while it's waiting (RFC-011). */
  watching?: Watching;
  /** For a node with `forEach`, how long its latest list was (RFC-013). */
  listed?: number;
  /** What it's doing, in a line, and when it ran; see activity.ts. */
  now?: string;
  startedAt?: string;
  finishedAt?: string;
  children: TreeNode[];
};

/**
 * A wait as the store knows it. Only changes are recorded, so how many looks
 * there have been since `at`, and when the next is, are worked out from
 * `every`.
 */
export type Watching = {
  until: string;
  every: string;
  timeout: string;
  startedAt: string;
  /** Looks up to the last change, and when that was. */
  looks: number;
  at: string;
  /** What the last look that changed anything said, and if it failed. */
  said?: string;
  ok?: boolean;
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

/**
 * The declared node an instance's id is of: a spawned worker (`<template>-<n>`)
 * or an item of a fanned node (`<node>.<n>`). A declared id has no `.`, so an
 * item's id never collides with one.
 */
export const templateOf = (
  id: string,
  declared: { has: (id: string) => boolean },
): string | undefined => {
  const match = /^(?<base>.+)[-.]\d+$/u.exec(id);
  const base = match?.groups?.["base"];
  return base !== undefined && declared.has(base) ? base : undefined;
};

const setItemsWaiting = (nodes: Iterable<TreeNode>, of: string): void => {
  for (const node of nodes) {
    if (node.template === of && isItem(node)) node.state = "waiting";
  }
};

/** Folds a run's events into its ownership tree; roots in declared order. */
export const runTree = (events: readonly RunEvent[]): TreeNode[] => {
  const nodes = new Map<string, TreeNode>();
  const declared = new Map<string, TreeNode>();
  const listedRounds = new Map<string, number>();
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
    } else if (event.type === "watch.started") {
      const node = nodes.get(event.id);
      if (node !== undefined) {
        const { until, every, timeout, at } = event;
        node.watching = {
          until,
          every,
          timeout,
          startedAt: at,
          looks: 0,
          at,
        };
      }
    } else if (event.type === "watch.changed") {
      const node = nodes.get(event.id);
      if (node?.watching !== undefined) {
        const { looks, at, said, ok } = event;
        node.watching = { ...node.watching, looks, at, said, ok };
      }
    } else if (event.type === "node.finished") {
      const node = nodes.get(event.id);
      if (node === undefined) continue;
      delete node.held;
      delete node.watching;
      node.state = event.ok ? "ok" : "failed";
      node.output = event.output;
      node.costUsd += event.usage?.costUsd ?? 0;
      node.inputTokens += event.usage?.inputTokens ?? 0;
      node.outputTokens += event.usage?.outputTokens ?? 0;
    } else if (event.type === "node.skipped") {
      const node = nodes.get(event.id);
      if (node !== undefined) node.state = "skipped";
    } else if (event.type === "each.listed") {
      const node = nodes.get(event.node);
      if (node !== undefined) node.listed = event.count;
      // A new round's items haven't run yet; a resume repeats the same round.
      if (event.round > (listedRounds.get(event.node) ?? 0)) {
        listedRounds.set(event.node, event.round);
        setItemsWaiting(nodes.values(), event.node);
      }
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

/** The nodes of a run waiting for a machine-wide slot now. */
export const slotWaitsOf = (events: readonly RunEvent[]): string[] => {
  const waiting = new Set<string>();
  for (const event of events) {
    if (event.type === "slot.waiting") waiting.add(event.id);
    else if (event.type === "slot.taken" || event.type === "node.finished") {
      waiting.delete(event.id);
    }
  }
  return [...waiting];
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

/**
 * A run's status, with `crashed` for a `running` run whose process is gone, or
 * is another process that got its id (`startOf` reads a process's start; the
 * default reads the system's).
 */
export const liveStatus = (
  run: RunRecord,
  startOf?: ProcessStartReader,
): StoredRunStatus | "crashed" =>
  run.status === "running" && !runProcessAlive(run, startOf)
    ? "crashed"
    : run.status;

/** `liveStatus`, with `paused` for a running run paused as a whole. */
export const runStatus = (
  run: RunRecord,
  events: readonly RunEvent[],
  startOf?: ProcessStartReader,
): StoredRunStatus | "crashed" | "paused" => {
  const status = liveStatus(run, startOf);
  return status === "running" && pausedOf(events).run ? "paused" : status;
};
