/**
 * @file The feedback map: how Ork captures what got in a run's way, groups it,
 *   turns accepted feedback into fixes and lessons, and publishes feedback
 *   about Ork itself to its GitHub Discussions.
 */

import { EDGES } from "./edges.js";
import { JOURNEYS } from "./journeys.js";
import { GROUPS, NODES, SIZE, ZONES } from "./nodes.js";

/** @type {import("../types.js").MapData} */
export const MAP = {
  id: "feedback",
  title: "Feedback loop",
  sub: "How runs teach Ork, the workflow and the repo",
  size: SIZE,
  zones: ZONES,
  groups: GROUPS,
  nodes: NODES,
  edges: EDGES,
  journeys: JOURNEYS,
};
