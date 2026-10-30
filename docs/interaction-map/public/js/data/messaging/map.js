/**
 * @file The messaging map: how nodes talk to each other and to you, and how
 *   every question reaches one inbox.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "messaging",
  title: "Messaging and decisions",
  sub: "How nodes talk to each other and to you",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
