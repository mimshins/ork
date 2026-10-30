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

export const edgeKey = (edge: CompiledEdge): string =>
  `${String(edge.source)}:${edge.from}->${edge.to}`;

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
        : truthy(evaluate(edge.condition, { ...scope, output: result.output }));
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

/**
 * Tracks, per target, which incoming non-loop edges have resolved since the
 * target last ran or was skipped.
 *
 * - A node runs when any incoming edge is taken, and is skipped once every
 *   incoming non-loop edge has resolved as not taken (dead-path elimination),
 *   so nothing downstream waits on a branch that will never run.
 * - A `control.join` waits: `all` until every input resolved, `any` for the first
 *   that ran, `n` for `n` that ran. A join none of whose required inputs ran is
 *   skipped.
 */
export const createInbox = (graph: CompiledGraph) => {
  const resolved = new Map<string, Map<string, Resolution>>();
  const fired = new Set<string>();

  const forwardIn = (id: string): CompiledEdge[] =>
    (graph.nodes.get(id)?.incoming ?? []).filter(e => !isLoopEdge(e));

  const reset = (id: string): void => {
    resolved.delete(id);
    fired.delete(id);
  };

  const arriveAtJoin = (id: string, seen: Map<string, Resolution>): Arrival => {
    const compiled = graph.nodes.get(id);
    const node = compiled?.node;
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
    const isJoin = graph.nodes.get(id)?.node.type === "control.join";
    if (!isJoin && taken) {
      reset(id);
      return { kind: "activate", input: output };
    }
    const seen = resolved.get(id) ?? new Map<string, Resolution>();
    resolved.set(id, seen);
    seen.set(edgeKey(edge), { taken, output });
    if (isJoin) return arriveAtJoin(id, seen);
    const inputs = forwardIn(id);
    const allDead = inputs.every(e => seen.get(edgeKey(e))?.taken === false);
    if (inputs.length > 0 && allDead) {
      reset(id);
      return { kind: "skip" };
    }
    return { kind: "wait" };
  };

  return { arrive };
};
