/**
 * @file Where a finished node's output goes: which outgoing edges are taken,
 *   and what each arrival does at its target (activate it, skip it, or wait,
 *   for a join). Pure: the scheduler owns time, sessions and loop counters.
 */

import { evaluate, type Scope, truthy } from "../expr/evaluate.ts";
import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";
import type { NodeOutput, NodeResult } from "./types.ts";

/** A `maxRounds` edge. Removing them leaves a DAG (the compiler checks it). */
export const isLoopEdge = (edge: CompiledEdge): boolean =>
  edge.maxRounds !== undefined;

const keys = new WeakMap<CompiledEdge, string>();

export const edgeKey = (edge: CompiledEdge): string => {
  let key = keys.get(edge);
  if (key === undefined) {
    key = `${String(edge.source)}:${edge.from}->${edge.to}`;
    keys.set(edge, key);
  }
  return key;
};

/**
 * Decides every outgoing edge of a finished node. An edge with `when:` is taken
 * when its condition holds for the node's output; one without is taken when the
 * node succeeded. A `control.router` in `first` mode takes only its first
 * matching edge.
 */
export const decideEdges = (
  graph: CompiledGraph,
  id: string,
  result: NodeResult,
  scope: Scope,
): { edge: CompiledEdge; taken: boolean }[] => {
  const compiled = graph.nodes.get(id);
  if (compiled === undefined) return [];
  const { node } = compiled;
  const firstOnly =
    node.type === "control.router" && (node.mode ?? "first") === "first";
  let matched = false;
  return compiled.outgoing.map(edge => {
    const holds =
      edge.condition === undefined
        ? result.ok
        : truthy(
            evaluate(edge.condition, {
              ...scope,
              // How it ended, unless the node reports a field of that name.
              output: { ok: result.ok, ...result.output },
            }),
          );
    const taken = holds && !(firstOnly && matched);
    if (taken) matched = true;
    return { edge, taken };
  });
};

export type Arrival =
  | { kind: "activate"; input: NodeOutput }
  | { kind: "skip" }
  | { kind: "wait" };

type Resolution = { taken: boolean; output: NodeOutput };

const joinOutput = (
  edges: readonly CompiledEdge[],
  resolved: ReadonlyMap<string, Resolution>,
): NodeOutput => {
  const ran = edges.filter(e => resolved.get(edgeKey(e))?.taken === true);
  const results: Record<string, NodeOutput> = {};
  for (const edge of ran) {
    results[edge.from] = resolved.get(edgeKey(edge))?.output ?? {};
  }
  return {
    statuses: ran.map(e => results[e.from]?.["status"]),
    results,
    count: ran.length,
  };
};

/** A node that an edge reached and that is still waiting on others. */
export type Waiting = { id: string; waitingOn: string[] };

/** How a reason for a run that was left waiting starts: a bug in Ork. */
export const STUCK_REASON = "ork engine error:";

/**
 * Why a run that was left waiting fails: a node neither ran nor was skipped
 * while an edge could still reach it. The scheduler resolves every edge whose
 * source can't run any more, so only a bug in Ork leaves one.
 */
export const stuckReason = (waiting: readonly Waiting[]): string =>
  `${STUCK_REASON} ${waiting
    .map(
      ({ id, waitingOn }) =>
        `${id} was still waiting on ${waitingOn.join(", ")}`,
    )
    .join(
      "; ",
    )} with nothing left to run; this is a bug in Ork, not in the workflow`;

/** Each node's place along the non-loop edges, sources first. */
const orderOf = (graph: CompiledGraph): Map<string, number> => {
  const order = new Map<string, number>();
  const left = new Map<string, number>();
  for (const [id, compiled] of graph.nodes) {
    left.set(id, compiled.incoming.filter(e => !isLoopEdge(e)).length);
  }
  const ready = [...left].filter(([, count]) => count === 0).map(([id]) => id);
  for (let id = ready.shift(); id !== undefined; id = ready.shift()) {
    order.set(id, order.size);
    for (const edge of graph.nodes.get(id)?.outgoing ?? []) {
      if (isLoopEdge(edge)) continue;
      const count = (left.get(edge.to) ?? 0) - 1;
      left.set(edge.to, count);
      if (count === 0) ready.push(edge.to);
    }
  }
  return order;
};

/**
 * Tracks, per target, which incoming non-loop edges have resolved in its
 * current round: since every one last resolved.
 *
 * - A node runs each time an incoming edge is taken, and is skipped once every
 *   incoming non-loop edge has resolved as not taken (dead-path elimination),
 *   so nothing downstream waits on a branch that will never run.
 * - A `control.join` waits: `all` until every input resolved, `any` for the first
 *   that ran, `n` for `n` that ran. A join none of whose required inputs ran is
 *   skipped.
 * - An edge whose source can't run any more counts as not taken (`stranded`): in
 *   a later round, a branch the loop doesn't go back to never runs again.
 */
export const createInbox = (graph: CompiledGraph) => {
  const resolved = new Map<string, Map<string, Resolution>>();
  /** Targets that ran, or joins that fired, in their current round. */
  const fired = new Set<string>();
  let order: Map<string, number> | undefined;

  const forwards = new Map<string, CompiledEdge[]>();
  const forwardIn = (id: string): CompiledEdge[] => {
    let edges = forwards.get(id);
    if (edges === undefined) {
      edges = (graph.nodes.get(id)?.incoming ?? []).filter(e => !isLoopEdge(e));
      forwards.set(id, edges);
    }
    return edges;
  };

  const reset = (id: string): void => {
    resolved.delete(id);
    fired.delete(id);
  };

  const arriveAtJoin = (id: string, seen: Map<string, Resolution>): Arrival => {
    const node = graph.nodes.get(id)?.node;
    if (node?.type !== "control.join") return { kind: "wait" };
    const inputs = forwardIn(id);
    const ran = inputs.filter(e => seen.get(edgeKey(e))?.taken === true);
    const complete = inputs.every(e => seen.has(edgeKey(e)));
    const mode = node.mode ?? "all";
    const needed = mode === "any" ? 1 : (node.n ?? inputs.length);

    if (mode === "all") {
      if (!complete) return { kind: "wait" };
      reset(id);
      return ran.length > 0
        ? { kind: "activate", input: joinOutput(inputs, seen) }
        : { kind: "skip" };
    }
    if (!fired.has(id) && ran.length >= needed) {
      const input = joinOutput(inputs, seen);
      if (complete) reset(id);
      else fired.add(id);
      return { kind: "activate", input };
    }
    if (!complete) return { kind: "wait" };
    const wasFired = fired.has(id);
    reset(id);
    return wasFired ? { kind: "wait" } : { kind: "skip" };
  };

  /** Records that `edge` resolved, and says what happens at its target. */
  const arrive = (
    edge: CompiledEdge,
    taken: boolean,
    output: NodeOutput,
  ): Arrival => {
    const id = edge.to;
    const seen = resolved.get(id) ?? new Map<string, Resolution>();
    resolved.set(id, seen);
    seen.set(edgeKey(edge), { taken, output });
    if (graph.nodes.get(id)?.node.type === "control.join") {
      return arriveAtJoin(id, seen);
    }
    const complete = forwardIn(id).every(e => seen.has(edgeKey(e)));
    const ran = taken || fired.has(id);
    if (complete) reset(id);
    else if (taken) fired.add(id);
    if (taken) return { kind: "activate", input: output };
    return complete && !ran ? { kind: "skip" } : { kind: "wait" };
  };

  /** The edges a target still waits on. */
  const missingOf = (id: string, seen: Map<string, Resolution>) =>
    forwardIn(id).filter(e => !seen.has(edgeKey(e)));

  /**
   * The first target, in graph order, whose every edge still to resolve comes
   * from a node that can't run any more: neither `active` (queued or running)
   * nor after one along the non-loop edges. A loop's edge starts a new round,
   * so it doesn't count. Its edges count as not taken; the caller delivers
   * them, and asks again, as that can start something.
   */
  const stranded = (active: (id: string) => boolean): CompiledEdge[] => {
    // Most often a source it waits on is running or queued: nothing to do.
    const candidates = [...resolved]
      .map(([id, seen]) => ({ id, missing: missingOf(id, seen) }))
      .filter(({ missing }) => !missing.some(e => active(e.from)));
    if (candidates.length === 0) return [];
    /** Nodes known to be unable to run, in this call. */
    const dead = new Set<string>();
    const canRun = (from: string): boolean => {
      const visited = new Set([from]);
      const stack = [from];
      for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
        if (active(id)) return true;
        for (const edge of forwardIn(id)) {
          if (visited.has(edge.from) || dead.has(edge.from)) continue;
          visited.add(edge.from);
          stack.push(edge.from);
        }
      }
      for (const id of visited) dead.add(id);
      return false;
    };
    order ??= orderOf(graph);
    const known = order;
    const place = (id: string) => known.get(id) ?? Infinity;
    const first = candidates
      .filter(({ missing }) => !missing.some(e => canRun(e.from)))
      .toSorted((a, b) => place(a.id) - place(b.id))[0];
    return first?.missing ?? [];
  };

  /** Targets an edge reached that still wait on others. */
  const waiting = (): Waiting[] =>
    [...resolved].map(([id, seen]) => ({
      id,
      waitingOn: [...new Set(missingOf(id, seen).map(e => e.from))],
    }));

  return { arrive, stranded, waiting };
};
