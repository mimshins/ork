/**
 * @file Moving between nodes with the arrow keys: along the edges in the
 *   direction pressed. Up and down also reach a node above or below on the same
 *   rank, so the siblings an edge fans out to are reachable from each other.
 */

import type { GraphLayout, PlacedNode } from "./types.ts";

export type Direction = "left" | "right" | "up" | "down";

const center = (node: PlacedNode): { x: number; y: number } => ({
  x: node.x + node.width / 2,
  y: node.y + node.height / 2,
});

const isToward = (
  direction: Direction,
  from: PlacedNode,
  to: PlacedNode,
): boolean => {
  const a = center(from);
  const b = center(to);
  if (direction === "left") return b.x < a.x;
  if (direction === "right") return b.x > a.x;
  return direction === "up" ? b.y < a.y : b.y > a.y;
};

/** Nearest first, counting the sideways distance as worse. */
const nearest = (
  direction: Direction,
  from: PlacedNode,
  candidates: readonly PlacedNode[],
): PlacedNode | undefined => {
  const a = center(from);
  const flat = direction === "left" || direction === "right";
  const score = (node: PlacedNode): number => {
    const b = center(node);
    const along = flat ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const aside = flat ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
    return along + aside * 2;
  };
  return candidates.toSorted((p, q) => score(p) - score(q))[0];
};

/** The node to move to from `id`, or `undefined` if none is that way. */
export const moveFrom = (
  layout: GraphLayout,
  id: string,
  direction: Direction,
): string | undefined => {
  const from = layout.nodes.find(node => node.id === id);
  if (from === undefined) return undefined;
  const joined = new Set(
    layout.edges.flatMap(edge => {
      if (edge.from === id) return [edge.to];
      return edge.to === id ? [edge.from] : [];
    }),
  );
  const others = layout.nodes.filter(node => node.id !== id);
  const along = others.filter(
    node => joined.has(node.id) && isToward(direction, from, node),
  );
  const flat = direction === "left" || direction === "right";
  const onRank = flat
    ? []
    : others.filter(
        node => node.x === from.x && isToward(direction, from, node),
      );
  // A sibling on the rank comes first, since up and down mean the next one.
  return (nearest(direction, from, onRank) ?? nearest(direction, from, along))
    ?.id;
};
