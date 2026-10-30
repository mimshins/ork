/** @file Lookups over one map's data, and finding a map by its id. */

import { MAPS } from "./data/maps.js";

/** @typedef {import("./data/types.js").MapData} MapData */
/** @typedef {import("./data/types.js").MapNode} MapNode */
/** @typedef {import("./data/types.js").MapEdge} MapEdge */
/** @typedef {import("./data/types.js").Tone} Tone */

/** @type {WeakMap<MapData, ReadonlyMap<string, MapNode>>} */
const index = new WeakMap();

/**
 * A map by its id.
 *
 * @param {string} id The map's id.
 * @returns {MapData | undefined} The map.
 */
export const mapById = id => MAPS.find(m => m.id === id);

/**
 * A node of a map by its id.
 *
 * @param {MapData} m The map.
 * @param {string} id The node's id.
 * @returns {MapNode | undefined} The node.
 */
export const nodeOf = (m, id) => {
  let byId = index.get(m);
  if (!byId) {
    byId = new Map(m.nodes.map(n => [n.id, n]));
    index.set(m, byId);
  }
  return byId.get(id);
};

/**
 * The colour of a node: its zone's.
 *
 * @param {MapData} m The map.
 * @param {MapNode | undefined} n The node.
 * @returns {Tone} The tone.
 */
export const toneOf = (m, n) =>
  m.zones.find(z => z.id === n?.zone)?.tone ?? "slate";

/**
 * The edge between two nodes, in either direction.
 *
 * @param {MapData} m The map.
 * @param {string} a One node's id.
 * @param {string} b The other node's id.
 * @returns {{ edge: MapEdge; reverse: boolean } | null} The edge and whether it
 *   runs from `b` to `a`.
 */
export const edgeBetween = (m, a, b) => {
  const fwd = m.edges.find(e => e.from === a && e.to === b);
  if (fwd) return { edge: fwd, reverse: false };
  const back = m.edges.find(e => e.from === b && e.to === a);
  return back ? { edge: back, reverse: true } : null;
};
