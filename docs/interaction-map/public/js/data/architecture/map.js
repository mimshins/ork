/**
 * @file The architecture map: Ork's packages and processes, and who talks to
 *   whom when a workflow runs.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "architecture",
  title: "Architecture",
  sub: "Ork's packages and processes, and who talks to whom",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
