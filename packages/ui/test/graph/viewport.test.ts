/** @file Tests for the graph's view arithmetic and its arrow-key moves. */

import { describe, expect, it } from "vitest";

import { layoutGraph } from "../../src/graph/layout.ts";
import { moveFrom } from "../../src/graph/moves.ts";
import type { GraphLayout } from "../../src/graph/types.ts";
import {
  boxOf,
  dotSpacing,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  onScreen,
  overlaps,
  panBy,
  reveal,
  zoomAt,
} from "../../src/graph/viewport.ts";

/** The nodes from the top of the drawing down. */
const byHeight = (layout: GraphLayout, ids: readonly string[]): string[] => {
  const heightOf = (id: string): number =>
    layout.nodes.find(node => node.id === id)?.y ?? 0;
  return ids.toSorted((a, b) => heightOf(a) - heightOf(b));
};

const CANVAS = { width: 800, height: 600 };

describe("the view", () => {
  it("fits a big drawing, centered", () => {
    const view = fitView({ width: 1600, height: 600 }, CANVAS);
    expect(view.k).toBe(0.5);
    expect(view.x).toBe(0);
    expect(view.y).toBe(150);
  });

  it("does not blow up a small drawing", () => {
    const view = fitView({ width: 100, height: 100 }, CANVAS);
    expect(view.k).toBe(1);
    expect(view.x).toBe(350);
  });

  it("does not divide by nothing", () => {
    expect(fitView({ width: 0, height: 0 }, CANVAS)).toEqual({
      x: 0,
      y: 0,
      k: 1,
    });
  });

  it("zooms around a point, which stays where it is", () => {
    const start = { x: 10, y: 20, k: 1 };
    const at = { x: 100, y: 100 };
    const view = zoomAt(start, 2, at);
    expect(view.k).toBe(2);
    const graphX = (at.x - start.x) / start.k;
    expect(graphX * view.k + view.x).toBe(at.x);
  });

  it("stops zooming at its limits", () => {
    const at = { x: 0, y: 0 };
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 100, at).k).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.001, at).k).toBe(MIN_ZOOM);
  });

  it("pans only as far as it must to show a node", () => {
    const view = { x: 0, y: 0, k: 1 };
    const inside = { x: 100, y: 100, width: 50, height: 50 };
    expect(reveal(view, inside, CANVAS)).toBe(view);
    const right = { x: 900, y: 100, width: 50, height: 50 };
    expect(reveal(view, right, CANVAS)).toEqual({ x: -174, y: 0, k: 1 });
  });

  it("moves a node out from under what covers the canvas", () => {
    const view = { x: 0, y: 0, k: 1 };
    const controls = { x: 600, y: 540, width: 190, height: 50 };
    const under = { x: 650, y: 500, width: 50, height: 60 };
    expect(reveal(view, under, CANVAS, controls)).toEqual({
      x: 0,
      y: -44,
      k: 1,
    });
    // Only a node actually under them moves.
    const beside = { x: 100, y: 500, width: 50, height: 60 };
    expect(reveal(view, beside, CANVAS, controls)).toBe(view);
  });

  it("moves it aside when there is no room above", () => {
    const view = { x: 0, y: 0, k: 1 };
    const short = { width: 800, height: 120 };
    const controls = { x: 600, y: 70, width: 190, height: 40 };
    const under = { x: 650, y: 30, width: 50, height: 60 };
    expect(reveal(view, under, short, controls).x).toBe(600 - 24 - 700);
  });

  it("knows what is on screen once panned and zoomed", () => {
    const view = panBy({ x: 0, y: 0, k: 2 }, -100, -40);
    const box = onScreen(view, CANVAS, 0);
    expect(box).toEqual({ x: 50, y: 20, width: 400, height: 300 });
    expect(overlaps(box, { x: 460, y: 20, width: 10, height: 10 })).toBe(false);
    expect(overlaps(box, { x: 440, y: 20, width: 20, height: 10 })).toBe(true);
  });

  it("scales the dots with the drawing", () => {
    expect(dotSpacing(1)).toBe(16);
    expect(dotSpacing(2)).toBe(32);
    expect(dotSpacing(0.75)).toBe(12);
  });

  it("drops every other dot rather than crowd them", () => {
    expect(dotSpacing(0.5)).toBe(16);
    expect(dotSpacing(0.25)).toBe(16);
    expect(dotSpacing(0.2)).toBeCloseTo(12.8);
  });

  it("boxes a line of points", () => {
    expect(
      boxOf([
        { x: 1, y: 5 },
        { x: 4, y: 2 },
      ]),
    ).toEqual({ x: 1, y: 2, width: 3, height: 3 });
  });
});

describe("moving with the arrow keys", () => {
  const layout = layoutGraph({
    nodes: ["start", "top", "bottom", "end"].map(id => ({
      id,
      type: "tool.shell",
    })),
    edges: [
      { from: "start", to: "top" },
      { from: "start", to: "bottom" },
      { from: "top", to: "end" },
      { from: "bottom", to: "end" },
    ],
  });

  it("goes along edges to the right and to the left", () => {
    expect(moveFrom(layout, "top", "right")).toBe("end");
    expect(moveFrom(layout, "top", "left")).toBe("start");
  });

  it("goes between siblings up and down", () => {
    const [upper = "", lower = ""] = byHeight(layout, ["top", "bottom"]);
    expect(moveFrom(layout, upper, "down")).toBe(lower);
    expect(moveFrom(layout, lower, "up")).toBe(upper);
  });

  it("stays put where nothing is that way", () => {
    expect(moveFrom(layout, "start", "left")).toBeUndefined();
    expect(moveFrom(layout, "end", "right")).toBeUndefined();
    expect(moveFrom(layout, "ghost", "right")).toBeUndefined();
  });
});
