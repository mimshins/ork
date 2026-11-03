/**
 * @file A last pass over the heights, so an edge reads as a line rather than a
 *   wobble: a node moves level with the node before it when that is a small
 *   step, and when its rank's order and spacing leave room.
 */

import type { Chain } from "./route.ts";

export type Straighten = {
  layers: readonly (readonly string[])[];
  chains: readonly Chain[];
  /** Each item's center height, which this changes. */
  centers: Map<string, number>;
  space: (a: string, b: string) => number;
  /** How far a node may move to line up. */
  reach: number;
};

export const straighten = ({
  layers,
  chains,
  centers,
  space,
  reach,
}: Straighten): void => {
  const height = (id: string): number => centers.get(id) ?? 0;
  const before = new Map<string, string[]>();
  for (const { edge, stops } of chains) {
    if (edge.kind === "flow" && stops.length === 2) {
      before.set(edge.to, [...(before.get(edge.to) ?? []), edge.from]);
    }
  }
  for (const items of layers) {
    for (const [index, id] of items.entries()) {
      const here = height(id);
      const nearest = (before.get(id) ?? [])
        .map(from => height(from))
        .toSorted((a, b) => Math.abs(a - here) - Math.abs(b - here))[0];
      const above = items[index - 1];
      const below = items[index + 1];
      if (
        nearest !== undefined &&
        Math.abs(nearest - here) < reach &&
        (above === undefined || height(above) + space(above, id) <= nearest) &&
        (below === undefined || nearest <= height(below) - space(id, below))
      ) {
        centers.set(id, nearest);
      }
    }
  }
};
