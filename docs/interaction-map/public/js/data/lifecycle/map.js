/**
 * @file The run lifecycle map: one run of the `software-factory` example, from
 *   `ork run` to a merge or a decision.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "lifecycle",
  title: "Run lifecycle",
  sub: "One run of software-factory, from `ork run` to a merge",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
