/**
 * @file Where a `readonly` node with no owner works: in the checkout its input
 *   came from, so a reviewer after a leader sees the leader's branch. The
 *   node's incoming edges are followed back through control nodes (joins,
 *   splits, routers) to the nodes that ran; when they all worked in one
 *   worktree, that is the place, and otherwise the project root.
 */

import type { CompiledGraph } from "../graph/types.ts";

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
    if (node?.node.type.startsWith("control.") === true) {
      queue.push(...node.incoming.map(e => e.from));
      continue;
    }
    const place = placeOf.get(from);
    if (place !== undefined && place !== root) places.add(place);
  }
  const [only, other] = places;
  return other === undefined ? only : undefined;
};
