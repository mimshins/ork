/**
 * @file The layout's third step: how high each item of a rank sits. It keeps
 *   each rank's order and spacing while pulling items level with what they
 *   join, so edges run straight where they can.
 */

import type { Link } from "./order.ts";

const PASSES = 12;

/**
 * The closest positions to `wanted` that keep the order and the given spaces
 * between neighbors: isotonic regression, pooling neighbors that collide.
 */
const fitted = (
  wanted: readonly number[],
  spaces: readonly number[],
): number[] => {
  const offsets: number[] = [];
  let total = 0;
  for (const [index] of wanted.entries()) {
    if (index > 0) total += spaces[index - 1] ?? 0;
    offsets.push(total);
  }
  const blocks: { sum: number; size: number }[] = [];
  for (const [index, value] of wanted.entries()) {
    blocks.push({ sum: value - (offsets[index] ?? 0), size: 1 });
    for (;;) {
      const last = blocks.at(-1);
      const before = blocks.at(-2);
      if (
        last === undefined ||
        before === undefined ||
        before.sum / before.size <= last.sum / last.size
      ) {
        break;
      }
      blocks.splice(-2, 2, {
        sum: before.sum + last.sum,
        size: before.size + last.size,
      });
    }
  }
  const levels = blocks.flatMap(({ sum, size }) =>
    Array.from({ length: size }, () => sum / size),
  );
  return levels.map((level, index) => level + (offsets[index] ?? 0));
};

/** Each item's center height. `space` is how far apart two neighbors must be. */
export const placeLayers = (
  layers: readonly (readonly string[])[],
  links: readonly Link[],
  space: (a: string, b: string) => number,
): Map<string, number> => {
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const [from, to] of links) {
    before.set(to, [...(before.get(to) ?? []), from]);
    after.set(from, [...(after.get(from) ?? []), to]);
  }
  const centers = new Map<string, number>();
  const settle = (
    layer: readonly string[],
    wanted: readonly number[],
  ): void => {
    const spaces = layer
      .slice(1)
      .map((id, index) => space(layer[index] ?? "", id));
    const places = fitted(wanted, spaces);
    for (const [index, id] of layer.entries()) {
      centers.set(id, places[index] ?? 0);
    }
  };
  for (const layer of layers)
    settle(
      layer,
      layer.map(() => 0),
    );

  const pull = (
    layer: readonly string[],
    sources: readonly ReadonlyMap<string, readonly string[]>[],
  ): void => {
    const wanted = layer.map(id => {
      const places = sources
        .flatMap(source => source.get(id) ?? [])
        .map(other => centers.get(other) ?? 0);
      return places.length === 0
        ? (centers.get(id) ?? 0)
        : places.reduce((sum, place) => sum + place, 0) / places.length;
    });
    settle(layer, wanted);
  };
  for (let pass = 0; pass < PASSES; pass += 1) {
    const down = pass % 2 === 0;
    for (const layer of down ? layers : layers.toReversed()) {
      // The last pass weighs both sides, so nothing leans one way.
      const both = pass === PASSES - 1;
      pull(layer, both ? [before, after] : [down ? before : after]);
    }
  }
  return centers;
};
