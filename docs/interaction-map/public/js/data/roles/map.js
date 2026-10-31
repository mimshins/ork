/**
 * @file The node roles map: the places a node can take in a workflow (entry,
 *   leaf, lone, skipped, unreachable, loop target, owned child, root, …), and
 *   what each means for when it runs and where its work ends up.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "roles",
  title: "Node roles",
  sub: "Entries, leaves, orphans, owned children: when each runs",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
