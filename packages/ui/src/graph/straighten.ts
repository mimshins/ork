/**
 * @file A last pass over the heights, so an edge reads as a line rather than a
 *   wobble: a node moves level with the node before it, or a first node with
 *   the one after it, when that is a small step and when its rank's order and
 *   spacing leave room.
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
  /** Moves a node level with the nearest of `others`, if that's a small step. */
  const levelWith = (
    id: string,
    others: readonly string[],
    above: string | undefined,
    below: string | undefined,
  ): void => {
    const here = height(id);
    const nearest = others
      .map(other => height(other))
      .toSorted((a, b) => Math.abs(a - here) - Math.abs(b - here))[0];
    if (
      nearest !== undefined &&
      Math.abs(nearest - here) < reach &&
      (above === undefined || height(above) + space(above, id) <= nearest) &&
      (below === undefined || nearest <= height(below) - space(id, below))
    ) {
      centers.set(id, nearest);
    }
  };
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const { edge, stops } of chains) {
    if (edge.kind === "flow" && stops.length === 2) {
      before.set(edge.to, [...(before.get(edge.to) ?? []), edge.from]);
      after.set(edge.from, [...(after.get(edge.from) ?? []), edge.to]);
    }
  }
  for (const items of layers) {
    for (const [index, id] of items.entries()) {
      levelWith(id, before.get(id) ?? [], items[index - 1], items[index + 1]);
    }
  }
  // Nothing leads into a first node, so nothing above lines it up: its next
  // node may be held in place by a loop's lane beside it.
  for (const items of layers) {
    for (const [index, id] of items.entries()) {
      if (!before.has(id)) {
        levelWith(id, after.get(id) ?? [], items[index - 1], items[index + 1]);
      }
    }
  }
};
