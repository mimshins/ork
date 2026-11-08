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
  /** How many characters a line of its label holds, if not `LABEL_LIMIT`. */
  labelLimit?: number;
};

export type GraphLayout = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** The size of the whole drawing, which starts at 0, 0. */
  width: number;
  height: number;
};

/** A word too long for a line, in pieces that each fit one. */
const piecesOf = (word: string, limit: number): string[] =>
  Array.from({ length: Math.ceil(word.length / limit) }, (_, index) =>
    word.slice(index * limit, (index + 1) * limit),
  );

/** A condition as it shows: all of it, wrapped at spaces to fit `limit`. */
export const labelLines = (label: string, limit = LABEL_LIMIT): string[] => {
  const lines: string[] = [];
  for (const word of label.split(" ").flatMap(w => piecesOf(w, limit))) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= limit) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
};

/** How tall a label of so many lines is, with its background. */
export const labelHeight = (lines: number): number =>
  lines * LABEL_LINE_HEIGHT + LABEL_PADDING / 8;

/** The room a node's arc to itself needs above the card, with its label. */
export const loopRoom = (label: string | undefined): number => {
  const lines = label === undefined ? [] : labelLines(label, LOOP_LABEL_LIMIT);
  return Math.ceil(
    (LOOP_HEIGHT * 3) / 4 + labelHeight(lines.length) / 2 + LOOP_CLEARANCE,
  );
};

export const NODE_WIDTH = 152;
export const NODE_HEIGHT = 46;
/** The space between ranks, where edges turn. */
export const RANK_GAP = 48;
/** The space between nodes of a rank. */
export const ROW_GAP = 20;
/** How far a node's arc to itself reaches up with its control points. */
export const LOOP_HEIGHT = 30;
/** The clear space between an arc's label and what is above it. */
const LOOP_CLEARANCE = 6;
/** How long a line of a condition beside its edge is, in characters. */
export const LABEL_LIMIT = 28;
/** How far apart the lines of a label are. */
export const LABEL_LINE_HEIGHT = 14;
/** How wide a character of a label is, on the mono font at its small size. */
export const LABEL_CHAR = 6.6;
/** The room around a label, within a gap and within its own background. */
export const LABEL_PADDING = 16;
/** How long a line of a self-loop's label is: it stays over its card. */
export const LOOP_LABEL_LIMIT = Math.floor(
  (NODE_WIDTH - LABEL_PADDING / 2) / LABEL_CHAR,
);
/** Clear space around the drawing, which a loop on a top node reaches into. */
export const MARGIN = 16;
