/**
 * @file The graph's layout, a pure function of the workflow: nodes on ranks
 *   left to right, by longest path, with loop edges left out of the ranking and
 *   drawn going back; order within a rank by barycenter, to cut crossings; then
 *   rounded orthogonal routes. A long edge gets a stop on each rank it crosses,
 *   so it runs between nodes rather than over them. Nodes the workflow's
 *   `.layout.json` places stay where they are, and edges then go straight
 *   between them.
 */

import { type Link, orderLayers } from "./order.ts";
import { placeLayers } from "./place.ts";
import { assignRanks, edgesOf, type LaidEdge } from "./ranks.ts";
import { type Chain, routeDirect, routeEdges } from "./route.ts";
import { straighten } from "./straighten.ts";
import {
  type GraphInput,
  type GraphLayout,
  LABEL_CHAR,
  LABEL_PADDING,
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  type PlacedEdge,
  type PlacedNode,
  type Point,
  RANK_GAP,
  ROW_GAP,
  shortLabel,
} from "./types.ts";

/** The space between a stop and what is next to it on a rank. */
const STOP_GAP = 14;

/** A stop's id says its edge and its rank, which a lane must keep clear on. */
const stopId = (edge: LaidEdge, rank: number): string =>
  `\0${String(edge.index)}:${String(rank)}`;

const isStop = (id: string): boolean => id.startsWith("\0");

/** How far apart two neighbors on a rank must be. */
const space = (a: string, b: string): number => {
  const half = (id: string): number => (isStop(id) ? 0 : NODE_HEIGHT / 2);
  const gap = isStop(a) || isStop(b) ? STOP_GAP : ROW_GAP;
  return half(a) + half(b) + gap;
};

/** Each edge's stops, from its source to its target. */
const chainsOf = (
  edges: readonly LaidEdge[],
  ranks: ReadonlyMap<string, number>,
): Chain[] =>
  edges.map(edge => {
    const start = ranks.get(edge.from) ?? 0;
    const end = ranks.get(edge.to) ?? 0;
    const step = end > start ? 1 : -1;
    const between = Array.from(
      { length: Math.max(Math.abs(end - start) - 1, 0) },
      (_, index) => stopId(edge, start + step * (index + 1)),
    );
    return { edge, stops: [edge.from, ...between, edge.to] };
  });

const linksOf = (
  chains: readonly Chain[],
  rankOf: (id: string) => number,
): Link[] =>
  chains.flatMap(({ stops }) =>
    stops.slice(1).flatMap((stop, index): Link[] => {
      const before = stops[index] ?? stop;
      const a = rankOf(before);
      const b = rankOf(stop);
      if (a === b) return [];
      return a < b ? [[before, stop]] : [[stop, before]];
    }),
  );

const boundsOf = (
  nodes: readonly PlacedNode[],
  edges: readonly PlacedEdge[],
): { minX: number; minY: number; maxX: number; maxY: number } => {
  const xs = [
    ...nodes.flatMap(node => [node.x, node.x + node.width]),
    ...edges.flatMap(edge => edge.points.map(point => point.x)),
  ];
  const ys = [
    ...nodes.flatMap(node => [node.y, node.y + node.height]),
    ...edges.flatMap(edge => edge.points.map(point => point.y)),
  ];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

/** Moves the drawing so it starts at the margin, and says how big it is. */
const framed = (nodes: PlacedNode[], edges: PlacedEdge[]): GraphLayout => {
  const { minX, minY, maxX, maxY } = boundsOf(nodes, edges);
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const moved = ({ x, y }: Point): Point => ({ x: x + dx, y: y + dy });
  return {
    nodes: nodes.map(node => ({ ...node, ...moved(node) })),
    edges: edges.map(edge => ({
      ...edge,
      points: edge.points.map(moved),
      ...(edge.labelAt === undefined ? {} : { labelAt: moved(edge.labelAt) }),
    })),
    width: maxX - minX + MARGIN * 2,
    height: maxY - minY + MARGIN * 2,
  };
};

export const layoutGraph = (input: GraphInput): GraphLayout => {
  const ids = input.nodes.map(node => node.id);
  const edges = edgesOf(input);
  const ranks = assignRanks(ids, edges);
  const chains = chainsOf(edges, ranks);

  const stopRanks = new Map<string, number>();
  for (const { edge, stops } of chains) {
    const start = ranks.get(edge.from) ?? 0;
    const end = ranks.get(edge.to) ?? 0;
    const step = end > start ? 1 : -1;
    for (const [index, stop] of stops.slice(1, -1).entries()) {
      stopRanks.set(stop, start + step * (index + 1));
    }
  }
  const rankOf = (id: string): number =>
    ranks.get(id) ?? stopRanks.get(id) ?? 0;

  const deepest = Math.max(0, ...ranks.values());
  const layers: string[][] = Array.from({ length: deepest + 1 }, () => []);
  for (const id of [...ids, ...stopRanks.keys()]) {
    layers[rankOf(id)]?.push(id);
  }
  const links = linksOf(chains, rankOf);
  const ordered = orderLayers(layers, links);
  const centers = placeLayers(ordered, links, space);
  straighten({
    layers: ordered,
    chains,
    centers,
    space,
    reach: ROW_GAP,
  });

  // A curve carries its condition in the gap it crosses, so it must fit. On a
  // longer edge it sits on the lane, which has a whole card's width to itself.
  const gaps = new Map<number, number>();
  for (const { edge, stops } of chains) {
    if (
      edge.label !== undefined &&
      edge.from !== edge.to &&
      stops.length === 2 &&
      rankOf(edge.from) !== rankOf(edge.to)
    ) {
      const gap = Math.min(rankOf(edge.from), rankOf(edge.to));
      const wanted =
        shortLabel(edge.label).length * LABEL_CHAR + LABEL_PADDING * 2;
      gaps.set(gap, Math.max(gaps.get(gap) ?? RANK_GAP, wanted));
    }
  }
  const gapWidth = (rank: number): number => gaps.get(rank) ?? RANK_GAP;
  const columns = [0];
  for (let rank = 0; rank < deepest; rank += 1) {
    columns.push((columns[rank] ?? 0) + NODE_WIDTH + gapWidth(rank));
  }
  const columnX = (rank: number): number => columns[rank] ?? 0;

  const placed = new Map<string, PlacedNode>(
    input.nodes.map(({ id, type }) => {
      const given = input.positions?.[id];
      const rank = rankOf(id);
      return [
        id,
        {
          id,
          type,
          x: given?.x ?? columnX(rank),
          y: given?.y ?? (centers.get(id) ?? 0) - NODE_HEIGHT / 2,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          rank,
        },
      ];
    }),
  );

  const placedByHand = Object.keys(input.positions ?? {}).length > 0;
  const routed = placedByHand
    ? edges.flatMap(edge => {
        const from = placed.get(edge.from);
        const to = placed.get(edge.to);
        return from === undefined || to === undefined
          ? []
          : [routeDirect(edge, from, to)];
      })
    : routeEdges({
        chains,
        nodes: placed,
        stopY: centers,
        rankOf,
        columnX,
        columnWidth: NODE_WIDTH,
        gapWidth,
      });
  return framed([...placed.values()], routed);
};
