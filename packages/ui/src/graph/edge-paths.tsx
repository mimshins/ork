/**
 * @file The graph's edges, one SVG drawing under the cards: rounded paths with
 *   an arrowhead, and conditions as labels. Each kind has its own line, so a
 *   loop or a channel reads without color. In a run, an edge whose node hasn't
 *   started is dotted, and packets move along one whose node is running; that's
 *   all the motion means. All of it is decoration for sight; the node cards and
 *   the node table carry the structure for everyone else.
 */

import { memo } from "react";

import type { NodeFacts } from "./facts.ts";
import { pathOf } from "./path.ts";
import {
  LABEL_CHAR,
  LABEL_PADDING,
  type PlacedEdge,
  type Point,
  shortLabel,
} from "./types.ts";

import styles from "./graph.module.css";

const HEAD = 6;
const LABEL_HEIGHT = 16;
/** A packet's side, the same as the width of its line in the style sheet. */
const PACKET = 3;

/** What an edge of a run shows, by the node it leads to. */
export const edgeStateOf = (
  kind: PlacedEdge["kind"],
  to?: NodeFacts,
): "pending" | "taken" | "flowing" | undefined => {
  if (to === undefined || (kind !== "flow" && kind !== "owner")) {
    return undefined;
  }
  if (to.status === "running") return "flowing";
  return to.status === "queued" || to.status === "skipped"
    ? "pending"
    : "taken";
};

/** About how long an edge is, which is near enough to space its packets. */
const lengthOf = (points: readonly Point[]): number =>
  points.reduce((length, point, index) => {
    const before = points[index - 1];
    return before === undefined
      ? length
      : length + Math.hypot(point.x - before.x, point.y - before.y);
  }, 0);

/**
 * Square packets half a trip apart: one dash as long as it's wide, along the
 * edge's own path, so it follows the curves wherever the view has moved. The
 * path counts as 2 long, so one dash and its gap are half a trip on any edge.
 */
const Packets = ({ path, length }: { path: string; length: number }) => {
  const dash = (PACKET * 2) / length;
  return (
    <path
      className={styles["packet"]}
      d={path}
      data-packet=""
      pathLength={2}
      strokeDasharray={`${String(dash)} ${String(1 - dash)}`}
    />
  );
};

/** A small triangle pointing along the edge's last run. */
const arrowhead = (points: readonly Point[]): string => {
  const tip = points.at(-1);
  const before = points.at(-2);
  if (tip === undefined || before === undefined) return "";
  const dx = Math.sign(tip.x - before.x);
  const dy = Math.sign(tip.y - before.y);
  const base = { x: tip.x - dx * HEAD, y: tip.y - dy * HEAD };
  const side = { x: -dy * (HEAD / 2), y: dx * (HEAD / 2) };
  return [
    tip,
    { x: base.x + side.x, y: base.y + side.y },
    { x: base.x - side.x, y: base.y - side.y },
  ]
    .map(({ x, y }) => `${String(x)},${String(y)}`)
    .join(" ");
};

/** A condition on a plain background, which the lines behind it stop at. */
const EdgeLabel = ({ label, at }: { label: string; at: Point }) => {
  const shown = shortLabel(label);
  const width = shown.length * LABEL_CHAR + LABEL_PADDING / 2;
  return (
    <g>
      <rect
        className={styles["edgeLabelBack"]}
        height={LABEL_HEIGHT}
        rx={2}
        width={width}
        x={at.x - width / 2}
        y={at.y - LABEL_HEIGHT / 2}
      />
      <text
        className={styles["edgeLabel"]}
        x={at.x}
        y={at.y}
      >
        <title>{label}</title>
        {shown}
      </text>
    </g>
  );
};

export const EdgePaths = memo(
  ({
    edges,
    facts,
    quiet,
    width,
    height,
  }: {
    edges: readonly PlacedEdge[];
    /** A run's nodes, to show how far it has got. */
    facts?: ReadonlyMap<string, NodeFacts> | undefined;
    /** A node is being pointed at, so the lines step back. */
    quiet: boolean;
    width: number;
    height: number;
  }) => (
    <svg
      aria-hidden="true"
      className={styles["edges"]}
      data-quiet={quiet ? "" : undefined}
      focusable="false"
      height={height}
      width={width}
    >
      {edges.map(edge => {
        const state = edgeStateOf(edge.kind, facts?.get(edge.to));
        const path = pathOf(edge);
        return (
          <g
            data-kind={edge.kind}
            data-state={state}
            key={`${edge.from}\n${edge.to}\n${edge.kind}`}
          >
            <path
              className={styles["edgeLine"]}
              d={path}
            />
            {edge.kind === "message" ? null : (
              <polygon
                className={styles["edgeHead"]}
                points={arrowhead(edge.points)}
              />
            )}
            {state === "flowing" ? (
              <Packets
                length={lengthOf(edge.points)}
                path={path}
              />
            ) : null}
            {edge.label === undefined || edge.labelAt === undefined ? null : (
              <EdgeLabel
                at={edge.labelAt}
                label={edge.label}
              />
            )}
          </g>
        );
      })}
    </svg>
  ),
);
EdgePaths.displayName = "EdgePaths";
