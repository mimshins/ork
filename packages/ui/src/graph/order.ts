/**
 * @file The layout's second step: the order of the nodes within each rank,
 *   which decides how many edges cross. It sweeps across the ranks, moving each
 *   item to the mean position of what it joins, and keeps the best order seen.
 *   Ties keep their order, so the same workflow always lays out the same.
 */

/** A pair of items on neighboring ranks, the lower rank first. */
export type Link = readonly [string, string];

const SWEEPS = 8;

const positionsIn = (layer: readonly string[]): Map<string, number> =>
  new Map(layer.map((id, index) => [id, index]));

/** How many pairs of links between these two layers cross. */
const crossingsBetween = (
  upper: readonly string[],
  lower: readonly string[],
  links: readonly Link[],
): number => {
  const a = positionsIn(upper);
  const b = positionsIn(lower);
  const pairs = links.flatMap(([from, to]) => {
    const start = a.get(from);
    const end = b.get(to);
    return start === undefined || end === undefined ? [] : [[start, end]];
  });
  let crossings = 0;
  for (const [index, [a1 = 0, b1 = 0] = []] of pairs.entries()) {
    for (const [a2 = 0, b2 = 0] of pairs.slice(index + 1)) {
      if ((a1 - a2) * (b1 - b2) < 0) crossings += 1;
    }
  }
  return crossings;
};

export const countCrossings = (
  layers: readonly (readonly string[])[],
  links: readonly Link[],
): number =>
  layers.slice(1).reduce((total, layer, index) => {
    const above = layers[index] ?? [];
    return total + crossingsBetween(above, layer, links);
  }, 0);

/** The layer in order of the mean position of each item's neighbors. */
const sorted = (
  layer: readonly string[],
  neighbors: ReadonlyMap<string, readonly string[]>,
  fixed: ReadonlyMap<string, number>,
): string[] => {
  const weigh = (id: string, index: number): number => {
    const places = (neighbors.get(id) ?? []).flatMap(other => {
      const place = fixed.get(other);
      return place === undefined ? [] : [place];
    });
    return places.length === 0
      ? index
      : places.reduce((sum, place) => sum + place, 0) / places.length;
  };
  return layer
    .map((id, index) => ({ id, index, weight: weigh(id, index) }))
    .toSorted((a, b) => a.weight - b.weight || a.index - b.index)
    .map(({ id }) => id);
};

export const orderLayers = (
  layers: readonly (readonly string[])[],
  links: readonly Link[],
): string[][] => {
  const above = new Map<string, string[]>();
  const below = new Map<string, string[]>();
  for (const [from, to] of links) {
    above.set(to, [...(above.get(to) ?? []), from]);
    below.set(from, [...(below.get(from) ?? []), to]);
  }
  let current = layers.map(layer => [...layer]);
  let best = current;
  let fewest = countCrossings(current, links);
  for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep += 1) {
    const down = sweep % 2 === 0;
    const next = current.map(layer => [...layer]);
    const indexes = next.map((_, index) => index);
    for (const index of down
      ? indexes.slice(1)
      : indexes.slice(0, -1).toReversed()) {
      const fixed = positionsIn(next[index + (down ? -1 : 1)] ?? []);
      next[index] = sorted(next[index] ?? [], down ? above : below, fixed);
    }
    current = next;
    const crossings = countCrossings(current, links);
    if (crossings < fewest) {
      fewest = crossings;
      best = current;
    }
  }
  return best;
};
