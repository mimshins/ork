/**
 * @file Timeouts on nodes and runs (ADR-043). A timeout measures work, so its
 *   clock stands still while the node or the run waits on the user: a pause, an
 *   open question or a permission prompt, its own or one of the nodes it owns.
 *   An expired node is aborted and fails with `timedOut` in its output; an
 *   executor that does not end after that is left behind, so a stuck session
 *   cannot hold the run. A `watch:` between looks (RFC-011) is no more work
 *   than a wait on the user, so the run's clock stands still when nothing else
 *   runs.
 */

import {
  isClaudeNode,
  isToolNode,
  type Node,
  timeoutMs,
  type Workflow,
} from "@krapht/ork-schema";

import type { CompiledGraph } from "../graph/types.ts";
import type { HoldPort, HumanChannel } from "../runtime/types.ts";
import { templateOf } from "../store/view.ts";
import { endedWith, endFor } from "./ended.ts";
import { heldTimeout, type Holds } from "./holds.ts";
import type { NodeResult } from "./types.ts";

/** How long an aborted node or run may take to end before it is left behind. */
export const TIMEOUT_GRACE_MS = 10_000;

type Clock = Pick<HoldPort, "held" | "watch">;

/** A promise that never settles: the losing side of a race. */
const NEVER = new Promise<never>(() => {
  // Never settles.
});

/** For a rejection no one is left to hear. */
const ignore = (): void => {
  // The node has already been reported as timed out.
};

/** The timeout that applies to a node; a gate's own means something else. */
export const timeoutOf = (node: Node, workflow: Workflow): string | undefined =>
  (isToolNode(node) ||
    isClaudeNode(node) ||
    node.type === "workflow.call" ||
    node.type === "mcp.call") &&
  node.type !== "claude.subagent"
    ? (node.timeout ?? workflow.defaults?.timeout)
    : undefined;

export const createClock = (options: {
  graph: CompiledGraph;
  holds: Holds;
  running: Set<string>;
}) => {
  const { graph, holds, running } = options;
  /** Nodes between two looks of a `watch:`. */
  const resting = new Set<string>();
  /** Nodes with a question or a prompt open, and how many. */
  const waiting = new Map<string, number>();
  const listeners = new Set<() => void>();

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  const asking = async <T>(id: string, asked: () => Promise<T>): Promise<T> => {
    waiting.set(id, (waiting.get(id) ?? 0) + 1);
    changed();
    try {
      return await asked();
    } finally {
      const left = (waiting.get(id) ?? 1) - 1;
      if (left === 0) waiting.delete(id);
      else waiting.set(id, left);
      changed();
    }
  };

  /**
   * The declared node behind an id; a worker is `<template>-<n>`, an item
   * `<node>.<n>`.
   */
  const declared = (id: string): string =>
    graph.nodes.has(id) ? id : (templateOf(id, graph.nodes) ?? id);

  const isOwnedBy = (owner: string, id: string): boolean => {
    const parent = graph.nodes.get(declared(id))?.node.parent;
    if (parent === undefined) return false;
    return parent === owner || isOwnedBy(owner, parent);
  };

  const isHeld = (id: string): boolean => holds.isHeld(id, declared(id));

  const watch: Clock["watch"] = listener => {
    listeners.add(listener);
    const unwatch = holds.watch(listener);
    return () => {
      listeners.delete(listener);
      unwatch();
    };
  };

  return {
    /** An activation began: what the run's clock reads may have changed. */
    enter: (id: string): void => {
      running.add(id);
      changed();
    },
    /** An activation ended. */
    leave: (id: string): void => {
      running.delete(id);
      resting.delete(id);
      changed();
    },
    /** A node between looks, or not any more. */
    resting: (id: string, on: boolean): void => {
      if (on) resting.add(id);
      else resting.delete(id);
      changed();
    },
    /** Stands the node's clock (and its owners' and the run's) still for `wait`. */
    waitFor: asking,
    /** The same channel, noting who waits on the user for how long. */
    human: (channel: HumanChannel): HumanChannel => ({
      permit: request => asking(request.nodeId, () => channel.permit(request)),
      ask: question => asking(question.nodeId, () => channel.ask(question)),
      ...(channel.settled === undefined ? {} : { settled: channel.settled }),
    }),
    /** Stands still while the node, or a node it owns, waits on the user. */
    forNode: (id: string): Clock => ({
      held: () =>
        isHeld(id) ||
        waiting.has(id) ||
        [...waiting.keys(), ...running].some(
          other =>
            isOwnedBy(declared(id), other) &&
            (waiting.has(other) || isHeld(other) || resting.has(other)),
        ),
      watch,
    }),
    /** Stands still while anything in the run waits on the user. */
    forRun: (): Clock => ({
      held: () =>
        holds.runPaused() ||
        waiting.size > 0 ||
        [...running].some(id => isHeld(id)) ||
        (running.size > 0 && [...running].every(id => resting.has(id))),
      watch,
    }),
  };
};

const timedOut = (timeout: string, partial: NodeResult | null): NodeResult => {
  const end = endFor("timed_out", { timeout });
  return endedWith(
    {
      ...partial,
      ok: false,
      output: {
        ...partial?.output,
        status: "fail",
        summary: end.message,
        timedOut: true,
      },
    },
    end,
  );
};

/** Runs `start` under `timeout`, if it has one. */
export const withTimeout = async (bound: {
  timeout: string | undefined;
  clock: Clock;
  signal: AbortSignal;
  graceMs: number;
  start: (signal: AbortSignal) => Promise<NodeResult>;
}): Promise<NodeResult> => {
  const { timeout, clock, signal, graceMs, start } = bound;
  const ms = timeoutMs(timeout);
  if (timeout === undefined || ms === undefined) return start(signal);
  const limit = new AbortController();
  const finished = new AbortController();
  let expired = false;
  let grace: NodeJS.Timeout | undefined;
  const running = start(AbortSignal.any([signal, limit.signal]));
  const leftBehind = heldTimeout(
    clock,
    ms,
    AbortSignal.any([signal, finished.signal]),
  ).then(elapsed => {
    if (!elapsed) return NEVER;
    expired = true;
    limit.abort();
    const { promise, resolve } = Promise.withResolvers<null>();
    grace = setTimeout(() => {
      resolve(null);
    }, graceMs);
    return promise;
  });
  // Once left behind, a late rejection has no one to tell.
  running.catch(ignore);
  try {
    const result = await Promise.race([running, leftBehind]);
    return expired || result === null ? timedOut(timeout, result) : result;
  } finally {
    clearTimeout(grace);
    finished.abort();
  }
};

/**
 * Ends the run when `limits.timeout` passes: `expire` at once, `leave` after
 * the grace, for executors that did not end. Returns what cancels it.
 */
export const watchRunTimeout = (watched: {
  timeout: string | undefined;
  clock: Clock;
  graceMs: number;
  expire: (reason: string) => void;
  leave: () => void;
}): (() => void) => {
  const { timeout, clock, graceMs, expire, leave } = watched;
  const ms = timeoutMs(timeout);
  const cancelled = new AbortController();
  let grace: NodeJS.Timeout | undefined;
  const watch = async (limit: number): Promise<void> => {
    if (!(await heldTimeout(clock, limit, cancelled.signal))) return;
    expire(`the run's timeout of ${String(timeout)} passed`);
    grace = setTimeout(leave, graceMs);
  };
  if (ms !== undefined) void watch(ms);
  return () => {
    clearTimeout(grace);
    cancelled.abort();
  };
};
