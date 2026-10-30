/**
 * @file The context map: what one node's session sees, where each piece comes
 *   from, and in what order.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "context",
  title: "Context and skills",
  sub: "What one node's session sees, and in what order",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
