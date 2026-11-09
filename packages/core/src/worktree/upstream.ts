/**
 * @file Where a `readonly` node with no owner works: in the checkout its input
 *   came from, so a reviewer after a leader sees the leader's branch. The
 *   node's incoming edges are followed back through control nodes (joins,
 *   splits, routers) and human gates, which work nowhere, to the nodes that
 *   ran; when they all worked in one worktree, that is the place, and otherwise
 *   the project root. A node with `forEach` worked where its items did.
 */

import type { CompiledGraph } from "../graph/types.ts";

/** Where `id` worked: its own place, or for a fanned node each item's. */
const placesOf = (
  id: string,
  placeOf: ReadonlyMap<string, string>,
): string[] => {
  const own = placeOf.get(id);
  if (own !== undefined) return [own];
  const item = `${id}.`;
  return [...placeOf]
    .filter(([other]) => other.startsWith(item))
    .map(([, place]) => place);
};

/**
 * The one place `id`'s upstream nodes worked in other than `root`, or
 * `undefined` when there is none or they disagree. `placeOf` is where each node
 * that ran worked.
 */
export const upstreamPlace = (
  graph: CompiledGraph,
  id: string,
  placeOf: ReadonlyMap<string, string>,
  root: string,
): string | undefined => {
  const places = new Set<string>();
  const seen = new Set<string>([id]);
  const queue = [...(graph.nodes.get(id)?.incoming ?? [])].map(e => e.from);
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    if (seen.has(from)) continue;
    seen.add(from);
    const node = graph.nodes.get(from);
    const type = node?.node.type ?? "";
    if (type.startsWith("control.") || type === "human.gate") {
      queue.push(...(node?.incoming ?? []).map(e => e.from));
      continue;
    }
    for (const place of placesOf(from, placeOf)) {
      if (place !== root) places.add(place);
    }
  }
  const [only, other] = places;
  return other === undefined ? only : undefined;
};
