/**
 * @file Edge geometry: where an edge leaves and enters a card, its SVG path,
 *   and points along it (for labels and step badges).
 */

import { NODE_H, NODE_W } from "./data/types.js";

/** @typedef {import("./data/types.js").MapNode} MapNode */
/** @typedef {{ x: number; y: number }} Point */
/** @typedef {{ x: number; y: number; w: number; h: number }} Rect */

/**
 * A drawable path with a way to find a point along it.
 *
 * @typedef {object} Geometry
 * @property {string} d The SVG path data.
 * @property {(t: number) => Point} at The point at fraction `t` (0–1) of the
 *   way.
 */

/** Corner radius of routed edges, in map units. */
const CORNER = 12;

/**
 * The card's rectangle.
 *
 * @param {MapNode} n The node.
 * @returns {Rect} Its rectangle.
 */
export const rectOf = n => ({ x: n.x, y: n.y, w: n.w ?? NODE_W, h: NODE_H });

/**
 * The card's centre.
 *
 * @param {MapNode} n The node.
 * @returns {Point} Its centre.
 */
export const centerOf = n => {
  const r = rectOf(n);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

/** @param {number} v @param {number} lo @param {number} hi */
const within = (v, lo, hi) => v >= lo && v <= hi;

/**
 * Where a routed edge attaches to a card, given the corner next to it: level
 * with the corner when the corner is beside the card, in line with it when the
 * corner is above or below.
 *
 * @param {Rect} r The card.
 * @param {Point} c The nearest corner.
 * @returns {Point} The attachment point.
 */
const attach = (r, c) => {
  if (within(c.y, r.y, r.y + r.h))
    return { x: c.x < r.x ? r.x : r.x + r.w, y: c.y };
  if (within(c.x, r.x, r.x + r.w))
    return { x: c.x, y: c.y < r.y ? r.y : r.y + r.h };
  const cx = r.x + r.w / 2;
  return { x: cx, y: c.y < r.y ? r.y : r.y + r.h };
};

/**
 * A smooth curve between the facing sides of two cards.
 *
 * @param {Rect} a The start card.
 * @param {Rect} b The end card.
 * @returns {Geometry} The curve.
 */
const curve = (a, b) => {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  /** @type {Point} */ let p0;
  /** @type {Point} */ let p3;
  /** @type {Point} */ let c1;
  /** @type {Point} */ let c2;
  if (gapX >= gapY) {
    const right = b.x > a.x;
    p0 = { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 };
    p3 = { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 };
    const k = Math.max(36, Math.abs(p3.x - p0.x) / 2);
    c1 = { x: p0.x + (right ? k : -k), y: p0.y };
    c2 = { x: p3.x - (right ? k : -k), y: p3.y };
  } else {
    const down = b.y > a.y;
    p0 = { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y };
    p3 = { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h };
    const k = Math.max(30, Math.abs(p3.y - p0.y) / 2);
    c1 = { x: p0.x, y: p0.y + (down ? k : -k) };
    c2 = { x: p3.x, y: p3.y - (down ? k : -k) };
  }
  const f = (/** @type {number} */ t) => {
    const u = 1 - t;
    return {
      x:
        u * u * u * p0.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * p3.x,
      y:
        u * u * u * p0.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * p3.y,
    };
  };
  return {
    d: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`,
    at: f,
  };
};

/**
 * Straight segments through the given points, with rounded corners.
 *
 * @param {Point[]} pts The points, start and end included.
 * @returns {Geometry} The path.
 */
const polyline = pts => {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    if (la === 0 || lb === 0) continue;
    const r = Math.min(CORNER, la / 2, lb / 2);
    const s = {
      x: p.x - ((p.x - a.x) / la) * r,
      y: p.y - ((p.y - a.y) / la) * r,
    };
    const e = {
      x: p.x + ((b.x - p.x) / lb) * r,
      y: p.y + ((b.y - p.y) / lb) * r,
    };
    d += ` L${s.x},${s.y} Q${p.x},${p.y} ${e.x},${e.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;

  const lens = pts
    .slice(1)
    .map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = lens.reduce((s, l) => s + l, 0);
  const at = (/** @type {number} */ t) => {
    let left = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (left <= lens[i] || i === lens.length - 1) {
        const f = lens[i] === 0 ? 0 : Math.min(1, left / lens[i]);
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
        };
      }
      left -= lens[i];
    }
    return last;
  };
  return { d, at };
};

/**
 * The geometry of a connection between two nodes.
 *
 * @param {MapNode} from The start node.
 * @param {MapNode} to The end node.
 * @param {[number, number][]} [via] Corner points; reversed with `reverse`.
 * @param {boolean} [reverse] Whether the `via` points run from `to` to `from`.
 * @returns {Geometry} The path from `from` to `to`.
 */
export const connect = (from, to, via, reverse = false) => {
  const a = rectOf(from);
  const b = rectOf(to);
  if (!via || via.length === 0) return curve(a, b);
  const corners = via.map(([x, y]) => ({ x, y }));
  if (reverse) corners.reverse();
  return polyline([
    attach(a, corners[0]),
    ...corners,
    attach(b, corners[corners.length - 1]),
  ]);
};
