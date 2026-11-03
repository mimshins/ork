/**
 * @file The graph's edges in words, per node. The edges are drawn for sight, so
 *   this is how a screen reader hears what a node comes after, leads to, owns
 *   and may message, with each edge's condition.
 */

import type { PlacedEdge } from "./types.ts";

const conditioned = (id: string, { label }: PlacedEdge): string =>
  label === undefined ? id : `${id} if ${label}`;

/** Each end's phrase for an edge: the verb, then who. */
const PHRASES: Readonly<
  Record<
    PlacedEdge["kind"],
    (edge: PlacedEdge) => {
      from: readonly [string, string];
      to: readonly [string, string];
    }
  >
> = {
  flow: edge => ({
    from: ["leads to", conditioned(edge.to, edge)],
    to: ["after", conditioned(edge.from, edge)],
  }),
  back: edge => ({
    from: ["goes back to", conditioned(edge.to, edge)],
    to: ["comes back from", conditioned(edge.from, edge)],
  }),
  owner: edge => ({
    from: ["owns", edge.to],
    to: ["owned by", edge.from],
  }),
  message: edge => ({
    from: ["can message", edge.to],
    to: ["can message", edge.from],
  }),
};

/** Node -> "after a, b; leads to c if ok". A node with no edges has no entry. */
export const connectionsOf = (
  edges: readonly PlacedEdge[],
): Map<string, string> => {
  const byNode = new Map<string, Map<string, string[]>>();
  const add = (node: string, [verb, who]: readonly [string, string]): void => {
    const verbs = byNode.get(node) ?? new Map<string, string[]>();
    verbs.set(verb, [...(verbs.get(verb) ?? []), who]);
    byNode.set(node, verbs);
  };
  for (const edge of edges) {
    const { from, to } = PHRASES[edge.kind](edge);
    add(edge.from, from);
    add(edge.to, to);
  }
  return new Map(
    [...byNode].map(([node, verbs]) => [
      node,
      [...verbs].map(([verb, who]) => `${verb} ${who.join(", ")}`).join("; "),
    ]),
  );
};
