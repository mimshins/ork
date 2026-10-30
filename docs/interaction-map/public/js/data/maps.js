/**
 * @file Every map, in the order the map switcher lists them. The first is the
 *   one a bare URL opens.
 */

import { MAP as architecture } from "./architecture/map.js";
import { MAP as context } from "./context/map.js";
import { MAP as lifecycle } from "./lifecycle/map.js";
import { MAP as messaging } from "./messaging/map.js";

/** @type {ReadonlyArray<import("./types.js").MapData>} */
export const MAPS = [architecture, lifecycle, context, messaging];
