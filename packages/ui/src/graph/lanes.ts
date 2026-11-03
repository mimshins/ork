/**
 * @file The lanes long edges run along: for the ranks an edge crosses, a height
 *   clear of every card there and of the lanes already taken, as near as it can
 *   be to where the edge would like to run.
 */

import type { PlacedNode } from "./types.ts";

/** How far a lane stays from a card and from another lane. */
const LANE_CLEARANCE = 12;

type Taken = { top: number; bottom: number };

/** Finds and keeps lanes clear of the cards and of each other. */
export const lanesFor = (
  nodes: ReadonlyMap<string, PlacedNode>,
  rankOf: (id: string) => number,
): ((ranks: readonly number[], wanted: readonly number[]) => number) => {
  const taken = new Map<number, Taken[]>();
  const take = (rank: number, top: number, bottom: number): void => {
    taken.set(rank, [...(taken.get(rank) ?? []), { top, bottom }]);
  };
  for (const node of nodes.values()) {
    take(
      rankOf(node.id),
      node.y - LANE_CLEARANCE,
      node.y + node.height + LANE_CLEARANCE,
    );
  }
  return (ranks, wanted) => {
    const isFree = (y: number): boolean =>
      ranks.every(rank =>
        (taken.get(rank) ?? []).every(
          ({ top, bottom }) => y <= top || y >= bottom,
        ),
      );
    const edges = ranks.flatMap(rank =>
      (taken.get(rank) ?? []).flatMap(({ top, bottom }) => [top, bottom]),
    );
    const near = wanted[0] ?? 0;
    const lane =
      wanted.find(y => isFree(y)) ??
      edges
        .filter(y => isFree(y))
        .toSorted(
          (a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b,
        )[0] ??
      near;
    for (const rank of ranks) {
      take(rank, lane - LANE_CLEARANCE, lane + LANE_CLEARANCE);
    }
    return lane;
  };
};
