/**
 * @file The layout's first step: what kind each edge is, and which rank each
 *   node is on. A node's rank is its longest path from a start. Loop edges are
 *   left out of that, and an owner counts as coming before a node nothing flows
 *   into.
 */

import type { EdgeKind, GraphInput } from "./types.ts";

export type LaidEdge = {
  index: number;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string | undefined;
};

/** Every edge the drawing has, among known nodes. */
export const edgesOf = (input: GraphInput): LaidEdge[] => {
  const known = new Set(input.nodes.map(node => node.id));
  const laid: LaidEdge[] = [];
  const add = (
    from: string,
    to: string,
    kind: EdgeKind,
    label?: string,
  ): void => {
    laid.push({ index: laid.length, from, to, kind, label });
  };
  const joined = new Set<string>();
  for (const { from, to, when, maxRounds } of input.edges) {
    if (known.has(from) && known.has(to)) {
      joined.add(`${from}\n${to}`);
      const loops = maxRounds !== undefined || from === to;
      add(from, to, loops ? "back" : "flow", when);
    }
  }
  for (const { id, parent } of input.nodes) {
    if (
      parent !== undefined &&
      known.has(parent) &&
      !joined.has(`${parent}\n${id}`)
    ) {
      add(parent, id, "owner");
    }
  }
  for (const [from, to] of input.channels ?? []) {
    if (known.has(from) && known.has(to) && from !== to) {
      add(from, to, "message");
    }
  }
  return laid;
};

/** Marks as `back` whatever still closes a cycle, as an old run's edges might. */
const breakCycles = (ids: readonly string[], ranking: LaidEdge[]): void => {
  const out = new Map<string, LaidEdge[]>();
  for (const edge of ranking) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  }
  const seen = new Map<string, "open" | "done">();
  const visit = (id: string): void => {
    seen.set(id, "open");
    for (const edge of out.get(id) ?? []) {
      const state = seen.get(edge.to);
      if (state === "open") edge.kind = "back";
      else if (state === undefined) visit(edge.to);
    }
    seen.set(id, "done");
  };
  for (const id of ids) {
    if (!seen.has(id)) visit(id);
  }
};

/** Each node's rank; the edges' kinds are settled too when this returns. */
export const assignRanks = (
  ids: readonly string[],
  edges: LaidEdge[],
): Map<string, number> => {
  const fedByFlow = new Set(
    edges.filter(edge => edge.kind === "flow").map(edge => edge.to),
  );
  const ranking = edges.filter(
    edge =>
      edge.kind === "flow" ||
      (edge.kind === "owner" && !fedByFlow.has(edge.to)),
  );
  breakCycles(ids, ranking);
  const forward = ranking.filter(edge => edge.kind !== "back");
  const ranks = new Map(ids.map(id => [id, 0]));
  let moved = true;
  for (let pass = 0; moved && pass <= ids.length; pass += 1) {
    moved = false;
    for (const { from, to } of forward) {
      const next = (ranks.get(from) ?? 0) + 1;
      if (next > (ranks.get(to) ?? 0)) {
        ranks.set(to, next);
        moved = true;
      }
    }
  }
  return ranks;
};
