/**
 * @file The graph's edges, one SVG drawing under the cards: rounded paths with
 *   an arrowhead, and conditions as labels. Each kind has its own line, so a
 *   loop or a channel reads without color. All of it is decoration for sight;
 *   the node cards and the ownership tree carry the structure for everyone
 *   else.
 */

import { memo } from "react";

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
    width,
    height,
  }: {
    edges: readonly PlacedEdge[];
    width: number;
    height: number;
  }) => (
    <svg
      aria-hidden="true"
      className={styles["edges"]}
      focusable="false"
      height={height}
      width={width}
    >
      {edges.map(edge => (
        <g
          data-kind={edge.kind}
          key={`${edge.from}\n${edge.to}\n${edge.kind}`}
        >
          <path
            className={styles["edgeLine"]}
            d={pathOf(edge)}
          />
          {edge.kind === "message" ? null : (
            <polygon
              className={styles["edgeHead"]}
              points={arrowhead(edge.points)}
            />
          )}
          {edge.label === undefined || edge.labelAt === undefined ? null : (
            <EdgeLabel
              at={edge.labelAt}
              label={edge.label}
            />
          )}
        </g>
      ))}
    </svg>
  ),
);
EdgePaths.displayName = "EdgePaths";
