/**
 * @file What the graph takes and gives: a workflow's nodes, edges and channels,
 *   and where the layout put them. Plain data, so the layout has no React in it
 *   and can be tested on the example workflows.
 */

export type Point = { x: number; y: number };

export type GraphNode = {
  id: string;
  type: string;
  /** The node that owns this one. */
  parent?: string | undefined;
};

export type GraphEdge = {
  from: string;
  to: string;
  /** Its condition, shown beside the edge. */
  when?: string | undefined;
  /** Set on a loop edge, which goes back rather than forward. */
  maxRounds?: number | undefined;
};

export type GraphInput = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Pairs of nodes that may message each other. */
  channels?: readonly (readonly [string, string])[] | undefined;
  /** From the workflow's `.layout.json`: these nodes stay where they are put. */
  positions?: Readonly<Record<string, Point>> | undefined;
};

/**
 * `flow` runs forward; `back` is a loop; `owner` joins a node to its owner when
 * no flow edge does; `message` is a channel.
 */
export type EdgeKind = "flow" | "back" | "owner" | "message";

export type PlacedNode = {
  id: string;
  type: string;
  /** Top left, in graph coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
};

export type PlacedEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * `curve`: one cubic, `points` being its start, two controls and end.
   * `lines`: straight runs through `points`, with rounded corners.
   */
  shape: "curve" | "lines";
  points: Point[];
  label?: string;
  /** Where its label goes. */
  labelAt?: Point;
};

export type GraphLayout = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** The size of the whole drawing, which starts at 0, 0. */
  width: number;
  height: number;
};

/** A condition as it shows, cut to the length a gap makes room for. */
export const shortLabel = (label: string): string =>
  label.length <= LABEL_LIMIT ? label : `${label.slice(0, LABEL_LIMIT - 1)}…`;

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;
/** The space between ranks, where edges turn. */
export const RANK_GAP = 72;
/** The space between nodes of a rank. */
export const ROW_GAP = 28;
/** How long a condition shows beside its edge, in characters. */
export const LABEL_LIMIT = 28;
/** How wide a character of a label is, on the mono font at its small size. */
export const LABEL_CHAR = 6.6;
/** The room around a label, within a gap and within its own background. */
export const LABEL_PADDING = 16;
/** Clear space around the drawing, which a loop on a top node reaches into. */
export const MARGIN = 32;
