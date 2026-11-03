/**
 * @file An edge's SVG path: one cubic curve, or straight lines with rounded
 *   corners, as the interaction map draws its edges.
 */

import type { PlacedEdge, Point } from "./types.ts";

const CORNER = 12;

const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  const part = length === 0 ? 0 : distance / length;
  return {
    x: from.x + (to.x - from.x) * part,
    y: from.y + (to.y - from.y) * part,
  };
};

const at = ({ x, y }: Point): string => `${String(x)} ${String(y)}`;

const lengthOf = (a: Point, b: Point): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const linesThrough = (points: readonly Point[]): string => {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  const parts = [`M ${at(first)}`];
  for (const [index, corner] of rest.entries()) {
    const before = points[index] ?? first;
    const after = rest[index + 1];
    if (after === undefined) {
      parts.push(`L ${at(corner)}`);
    } else {
      const radius = Math.min(
        CORNER,
        lengthOf(before, corner) / 2,
        lengthOf(corner, after) / 2,
      );
      parts.push(
        `L ${at(toward(corner, before, radius))}`,
        `Q ${at(corner)} ${at(toward(corner, after, radius))}`,
      );
    }
  }
  return parts.join(" ");
};

export const pathOf = ({
  shape,
  points,
}: Pick<PlacedEdge, "shape" | "points">): string => {
  const [start, one, two, end] = points;
  return shape === "curve" &&
    start !== undefined &&
    one !== undefined &&
    two !== undefined &&
    end !== undefined
    ? `M ${at(start)} C ${at(one)} ${at(two)} ${at(end)}`
    : linesThrough(points);
};
