/**
 * @file The layout's last step: the shape of each edge, in the interaction
 *   map's style. Nodes on neighboring ranks are joined by one smooth curve
 *   between their facing sides. A longer edge runs level along one lane through
 *   the ranks it crosses, with rounded corners, so it never climbs in steps.
 *   Loops and channels attach just off the middle of a side, apart from the
 *   flow.
 */

import { lanesFor } from "./lanes.ts";
import type { LaidEdge } from "./ranks.ts";
import type { EdgeKind, PlacedEdge, PlacedNode, Point } from "./types.ts";

/** An edge's way through the ranks: its two nodes, and a stop on each between. */
export type Chain = { edge: LaidEdge; stops: string[] };

export type RouteInput = {
  chains: readonly Chain[];
  nodes: ReadonlyMap<string, PlacedNode>;
  /** The height ordering chose for a stop, a good first try for a lane. */
  stopY: ReadonlyMap<string, number>;
  /** The rank a node is on. */
  rankOf: (id: string) => number;
  columnX: (rank: number) => number;
  columnWidth: number;
  /** How wide the gap to the right of a rank is. */
  gapWidth: (rank: number) => number;
};

const LOOP_HEIGHT = 30;
const BULGE = 48;
const MIN_CURVE = 36;

/** Where each kind attaches, from the middle of a card's side. */
const OFFSET: Readonly<Record<EdgeKind, number>> = {
  flow: 0,
  owner: 0,
  back: 14,
  message: -14,
};

const attachY = (node: PlacedNode, kind: EdgeKind): number =>
  node.y + node.height / 2 + OFFSET[kind];

const xOf = (point: Point | undefined): number => point?.x ?? 0;
const yOf = (point: Point | undefined): number => point?.y ?? 0;

/** The point halfway along a cubic curve. */
const curveMiddle = ([a, b, c, d]: readonly Point[]): Point => ({
  x: (xOf(a) + 3 * xOf(b) + 3 * xOf(c) + xOf(d)) / 8,
  y: (yOf(a) + 3 * yOf(b) + 3 * yOf(c) + yOf(d)) / 8,
});

const curved = (edge: LaidEdge, points: Point[]): PlacedEdge => ({
  from: edge.from,
  to: edge.to,
  kind: edge.kind,
  shape: "curve",
  points,
  ...(edge.label === undefined
    ? {}
    : { label: edge.label, labelAt: curveMiddle(points) }),
});

/** A curve leaving and entering level, across the gap between two sides. */
const across = (edge: LaidEdge, from: Point, to: Point): PlacedEdge => {
  const pull = Math.max(MIN_CURVE, Math.abs(to.x - from.x) / 2);
  const way = to.x >= from.x ? 1 : -1;
  return curved(edge, [
    from,
    { x: from.x + pull * way, y: from.y },
    { x: to.x - pull * way, y: to.y },
    to,
  ]);
};

const selfLoop = (edge: LaidEdge, node: PlacedNode): PlacedEdge => {
  const left = node.x + node.width * 0.3;
  const right = node.x + node.width * 0.7;
  const top = node.y - LOOP_HEIGHT;
  return curved(edge, [
    { x: right, y: node.y },
    { x: right, y: top },
    { x: left, y: top },
    { x: left, y: node.y },
  ]);
};

/** Two nodes on one rank: out of one's right side and into the other's. */
const bulge = (
  edge: LaidEdge,
  from: PlacedNode,
  to: PlacedNode,
): PlacedEdge => {
  const start = {
    x: from.x + from.width,
    y: attachY(from, edge.kind),
  };
  const end = { x: to.x + to.width, y: attachY(to, edge.kind) };
  return curved(edge, [
    start,
    { x: start.x + BULGE, y: start.y },
    { x: end.x + BULGE, y: end.y },
    end,
  ]);
};

/** Takes out repeated points, and the middle of three in a line. */
const simplified = (points: readonly Point[]): Point[] => {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    const before = kept.at(-2);
    if (last?.x === point.x && last.y === point.y) continue;
    const straight =
      last !== undefined &&
      before !== undefined &&
      ((before.x === last.x && last.x === point.x) ||
        (before.y === last.y && last.y === point.y));
    if (straight) kept.pop();
    kept.push(point);
  }
  return kept;
};

/** The middle of a line's longest straight run, where its label reads best. */
const longestRunMiddle = (points: readonly Point[]): Point => {
  let spot = points[0] ?? { x: 0, y: 0 };
  let longest = -1;
  for (const [index, point] of points.slice(1).entries()) {
    const from = points[index] ?? point;
    const length = Math.abs(point.x - from.x) + Math.abs(point.y - from.y);
    if (length > longest) {
      longest = length;
      spot = { x: (from.x + point.x) / 2, y: (from.y + point.y) / 2 };
    }
  }
  return spot;
};

const lined = (edge: LaidEdge, points: readonly Point[]): PlacedEdge => {
  const clean = simplified(points);
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    shape: "lines",
    points: clean,
    ...(edge.label === undefined
      ? {}
      : { label: edge.label, labelAt: longestRunMiddle(clean) }),
  };
};

export const routeEdges = (input: RouteInput): PlacedEdge[] => {
  const { chains, nodes, stopY, rankOf, columnX, columnWidth, gapWidth } =
    input;
  const rightOf = (rank: number): number => columnX(rank) + columnWidth;
  const laneFor = lanesFor(nodes, rankOf);
  const long = chains.filter(({ stops }) => stops.length > 2);

  // Each long edge's lane first, then how many corners share each gap.
  const lanes = new Map<number, number>();
  const turns = new Map<number, number[]>();
  for (const { edge, stops } of long) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from !== undefined && to !== undefined) {
      const startY = attachY(from, edge.kind);
      const endY = attachY(to, edge.kind);
      const lane = laneFor(
        stops.slice(1, -1).map(stop => {
          const [, rank = ""] = stop.split(":");
          return Number(rank);
        }),
        [
          startY,
          endY,
          ...stops.slice(1, -1).map(stop => stopY.get(stop) ?? startY),
        ],
      );
      lanes.set(edge.index, lane);
      const low = Math.min(rankOf(edge.from), rankOf(edge.to));
      const high = Math.max(rankOf(edge.from), rankOf(edge.to));
      for (const gap of [low, high - 1]) {
        turns.set(gap, [...(turns.get(gap) ?? []), edge.index]);
      }
    }
  }
  /** The upright run of a long edge in this gap, each on its own track. */
  const trackX = (gap: number, edge: number): number => {
    const sharing = turns.get(gap) ?? [];
    return (
      rightOf(gap) +
      (gapWidth(gap) * (sharing.indexOf(edge) + 1)) / (sharing.length + 1)
    );
  };

  return chains.flatMap(({ edge }) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined) return [];
    if (edge.from === edge.to) return [selfLoop(edge, from)];
    const startRank = rankOf(edge.from);
    const endRank = rankOf(edge.to);
    if (startRank === endRank) return [bulge(edge, from, to)];
    const onward = endRank > startRank;
    const start = {
      x: onward ? from.x + from.width : from.x,
      y: attachY(from, edge.kind),
    };
    const end = {
      x: onward ? to.x : to.x + to.width,
      y: attachY(to, edge.kind),
    };
    const lane = lanes.get(edge.index);
    if (lane === undefined) return [across(edge, start, end)];
    const low = Math.min(startRank, endRank);
    const high = Math.max(startRank, endRank);
    const firstX = trackX(onward ? low : high - 1, edge.index);
    const lastX = trackX(onward ? high - 1 : low, edge.index);
    return [
      lined(edge, [
        start,
        { x: firstX, y: start.y },
        { x: firstX, y: lane },
        { x: lastX, y: lane },
        { x: lastX, y: end.y },
        end,
      ]),
    ];
  });
};
