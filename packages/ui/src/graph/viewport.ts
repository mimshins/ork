/**
 * @file The graph's view as plain arithmetic: pan and zoom as a transform,
 *   fitting the drawing, bringing a node into view, and what is on screen.
 */

import type { Point } from "./types.ts";

/** Graph point (x, y) shows at (x * k + this.x, y * k + this.y) on the canvas. */
export type View = { x: number; y: number; k: number };

export type Size = { width: number; height: number };

export type Box = { x: number; y: number; width: number; height: number };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;

const clampZoom = (k: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The whole drawing, centered, and never bigger than life. */
export const fitView = (drawing: Size, canvas: Size): View => {
  if (drawing.width <= 0 || drawing.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(
    Math.min(1, canvas.width / drawing.width, canvas.height / drawing.height),
  );
  return {
    x: (canvas.width - drawing.width * k) / 2,
    y: (canvas.height - drawing.height * k) / 2,
    k,
  };
};

/** Zooms by `factor`, keeping what is under `at` where it is. */
export const zoomAt = (view: View, factor: number, at: Point): View => {
  const k = clampZoom(view.k * factor);
  const scale = k / view.k;
  return {
    k,
    x: at.x - (at.x - view.x) * scale,
    y: at.y - (at.y - view.y) * scale,
  };
};

export const panBy = (view: View, dx: number, dy: number): View => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/** The least pan that shows `box` with `margin` around it, or the same view. */
export const reveal = (
  view: View,
  box: Box,
  canvas: Size,
  margin = 24,
): View => {
  const shift = (start: number, length: number, room: number): number => {
    const end = start + length;
    if (length + margin * 2 >= room) return (room - length) / 2 - start;
    if (start < margin) return margin - start;
    return end > room - margin ? room - margin - end : 0;
  };
  const dx = shift(box.x * view.k + view.x, box.width * view.k, canvas.width);
  const dy = shift(box.y * view.k + view.y, box.height * view.k, canvas.height);
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
};

/** What the canvas shows, in graph coordinates, with `margin` px extra. */
export const onScreen = (view: View, canvas: Size, margin = 160): Box => ({
  x: (-margin - view.x) / view.k,
  y: (-margin - view.y) / view.k,
  width: (canvas.width + margin * 2) / view.k,
  height: (canvas.height + margin * 2) / view.k,
});

export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** The canvas's dots, in graph units, and how close they may come on screen. */
const DOT_STEP = 16;
const MIN_DOT_SPACING = 12;

/**
 * How far apart the dots are on screen. They belong to the drawing, so they
 * scale with it, and every other one drops out when they would crowd together.
 */
export const dotSpacing = (k: number): number => {
  let spacing = DOT_STEP * k;
  while (spacing < MIN_DOT_SPACING) spacing *= 2;
  return spacing;
};

/** The box around a line of points. */
export const boxOf = (points: readonly Point[]): Box => {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
};
