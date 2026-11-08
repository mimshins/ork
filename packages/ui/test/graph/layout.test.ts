/**
 * @file Tests for the graph's layout on the example workflows and on small
 *   graphs: nothing overlaps, edges run forward and clear of cards, loops go
 *   back, it is the same every time, and hand-placed nodes stay put.
 */

import path from "node:path";

import { readWorkflowGraph } from "@krapht/ork-server";
import { describe, expect, it } from "vitest";

import { layoutGraph } from "../../src/graph/layout.ts";
import { countCrossings } from "../../src/graph/order.ts";
import {
  type GraphInput,
  type GraphLayout,
  LABEL_CHAR,
  labelHeight,
  labelLines,
  MARGIN,
  type PlacedNode,
  type Point,
} from "../../src/graph/types.ts";

const example = (name: string): GraphInput => {
  const graph = readWorkflowGraph(
    path.resolve(import.meta.dirname, `../../../../examples/${name}.ork.yaml`),
  );
  if (graph === null) throw new Error(`no example ${name}`);
  return graph;
};

/** What a loop or a channel may stick out beyond the cards. */
const LOOP_ROOM = 60;

const EXAMPLES = ["software-factory", "pr-review", "across-projects"];

/** The highest point of the layout's first edge. */
const topOfFirstEdge = (layout: GraphLayout): number =>
  Math.min(...(layout.edges[0]?.points ?? []).map(point => point.y));

/** How many corners an edge has. */
const turnsOf = (layout: GraphLayout, from: string, to: string): number =>
  (
    layout.edges.find(edge => edge.from === from && edge.to === to)?.points ??
    []
  ).length - 2;

/** Edges with more corners than leaving, one lane, and arriving need. */
const steppedEdges = (layout: GraphLayout): string[] =>
  layout.edges
    .filter(edge => edge.shape === "lines")
    .filter(edge => edge.points.length > 6)
    .map(edge => `${edge.from}->${edge.to}`);

/** How many times an edge changes height. */
const uprightRuns = (layout: GraphLayout, from: string, to: string): number => {
  const points =
    layout.edges.find(edge => edge.from === from && edge.to === to)?.points ??
    [];
  return points.slice(1).filter((point, index) => point.x === points[index]?.x)
    .length;
};

const nodeOf = (layout: GraphLayout, id: string): PlacedNode => {
  const found = layout.nodes.find(node => node.id === id);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found;
};

const overlapping = (layout: GraphLayout): string[] =>
  layout.nodes.flatMap((a, index) =>
    layout.nodes
      .slice(index + 1)
      .filter(
        b =>
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height,
      )
      .map(b => `${a.id} over ${b.id}`),
  );

/** Whether a straight run between two points goes through a card's inside. */
const cuts = (a: Point, b: Point, node: PlacedNode): boolean => {
  const inset = 1;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return (
    left < node.x + node.width - inset &&
    right > node.x + inset &&
    top < node.y + node.height - inset &&
    bottom > node.y + inset
  );
};

const edgesThroughCards = (layout: GraphLayout): string[] =>
  layout.edges.flatMap(edge =>
    edge.points.slice(1).flatMap((point, index) => {
      const start = edge.points[index] ?? point;
      return layout.nodes
        .filter(node => cuts(start, point, node))
        .map(node => `${edge.from}->${edge.to} through ${node.id}`);
    }),
  );

describe.each(EXAMPLES)("the layout of %s", name => {
  const input = example(name);
  const layout = layoutGraph(input);

  it("places every node, with none on another", () => {
    expect(layout.nodes.map(node => node.id).toSorted()).toEqual(
      input.nodes.map(node => node.id).toSorted(),
    );
    expect(overlapping(layout)).toEqual([]);
  });

  it("runs flow edges left to right, on later ranks", () => {
    const backwards = layout.edges
      .filter(edge => edge.kind === "flow")
      .filter(
        edge => nodeOf(layout, edge.to).rank <= nodeOf(layout, edge.from).rank,
      )
      .map(edge => `${edge.from}->${edge.to}`);
    expect(backwards).toEqual([]);
  });

  it("draws edges clear of the cards", () => {
    expect(edgesThroughCards(layout)).toEqual([]);
  });

  it("stays inside its drawing, starting at the margin", () => {
    const xs = layout.nodes.flatMap(node => [node.x, node.x + node.width]);
    const ys = layout.nodes.flatMap(node => [node.y, node.y + node.height]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(MARGIN);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(MARGIN);
    expect(Math.max(...xs)).toBeLessThanOrEqual(layout.width - MARGIN);
    expect(Math.max(...ys)).toBeLessThanOrEqual(layout.height - MARGIN);
  });

  it("has no empty space around its drawing", () => {
    const xs = layout.nodes.flatMap(node => [node.x, node.x + node.width]);
    const ys = layout.nodes.flatMap(node => [node.y, node.y + node.height]);
    const slack = LOOP_ROOM + MARGIN;
    expect(Math.min(...xs)).toBeLessThanOrEqual(slack);
    expect(Math.min(...ys)).toBeLessThanOrEqual(slack);
  });

  it("gives the same layout every time", () => {
    expect(layoutGraph(input)).toEqual(layout);
  });

  it("draws no edge in steps: a curve, or a few rounded corners", () => {
    expect(steppedEdges(layout)).toEqual([]);
  });
});

/** Whether each flow curve is straight, or joins cards too far apart for that. */
const everyEdgeLevelOrApart = (
  layout: ReturnType<typeof layoutGraph>,
): boolean =>
  layout.edges.every(edge => {
    const from = layout.nodes.find(({ id }) => id === edge.from);
    const to = layout.nodes.find(({ id }) => id === edge.to);
    const shared =
      from === undefined || to === undefined
        ? 0
        : Math.min(from.y + from.height, to.y + to.height) -
          Math.max(from.y, to.y);
    return shared < 16 || new Set(edge.points.map(({ y }) => y)).size === 1;
  });

/** A self-loop's whole label, its longest line's width, and where its top is. */
const selfLoopLabel = (
  layout: GraphLayout,
): { text: string; shownWidth: number; top: number } => {
  const edge = layout.edges.find(({ from, to }) => from === to);
  const lines = labelLines(edge?.label ?? "", edge?.labelLimit);
  return {
    text: lines.join(" "),
    shownWidth: Math.max(...lines.map(({ length }) => length)) * LABEL_CHAR,
    top: (edge?.labelAt?.y ?? 0) - labelHeight(lines.length) / 2,
  };
};

describe("the layout", () => {
  it("leaves loops out of the ranking, and draws them going back", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "a", type: "tool.shell" },
        { id: "b", type: "tool.shell" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a", maxRounds: 2, when: "again" },
      ],
    });
    expect(nodeOf(layout, "a").rank).toBe(0);
    expect(nodeOf(layout, "b").rank).toBe(1);
    expect(layout.edges.map(edge => edge.kind)).toEqual(["flow", "back"]);
    const back = layout.edges[1];
    expect(back?.label).toBe("again");
    expect(back?.points.at(0)?.x).toBe(nodeOf(layout, "b").x);
    expect(back?.points.at(-1)?.x).toBe(
      nodeOf(layout, "a").x + nodeOf(layout, "a").width,
    );
  });

  it("draws a node looping to itself as an arc above it", () => {
    const layout = layoutGraph({
      nodes: [{ id: "kit", type: "workflow.call" }],
      edges: [{ from: "kit", to: "kit", maxRounds: 2 }],
    });
    expect(layout.edges.map(edge => edge.kind)).toEqual(["back"]);
    expect(topOfFirstEdge(layout)).toBeLessThan(nodeOf(layout, "kit").y);
    expect(topOfFirstEdge(layout)).toBeGreaterThanOrEqual(0);
  });

  it("keeps a self-loop's label over its card and clear of the card above", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "start", type: "tool.shell" },
        { id: "above", type: "tool.shell" },
        { id: "kit", type: "tool.shell" },
      ],
      edges: [
        { from: "start", to: "above" },
        { from: "start", to: "kit" },
        {
          from: "kit",
          to: "kit",
          maxRounds: 2,
          when: "status == 'pass' && coverage == 'partial'",
        },
      ],
    });
    const kit = nodeOf(layout, "kit");
    const above = nodeOf(layout, "above");
    const { text, shownWidth, top } = selfLoopLabel(layout);
    expect(text).toBe("status == 'pass' && coverage == 'partial'");
    expect(shownWidth).toBeGreaterThan(0);
    expect(shownWidth).toBeLessThanOrEqual(kit.width);
    expect(top).toBeGreaterThan(above.y + above.height);
  });

  it("does not hang on a cycle with no maxRounds", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "a", type: "tool.shell" },
        { id: "b", type: "tool.shell" },
        { id: "c", type: "tool.shell" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    expect(layout.edges.map(edge => edge.kind)).toEqual([
      "flow",
      "flow",
      "back",
    ]);
  });

  it("runs a long edge around the nodes between", () => {
    const layout = layoutGraph({
      nodes: ["a", "b", "c", "d"].map(id => ({ id, type: "tool.shell" })),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "a", to: "d" },
      ],
    });
    expect(edgesThroughCards(layout)).toEqual([]);
    expect(overlapping(layout)).toEqual([]);
  });

  it("puts a node with only an owner after its owner, joined by an owner edge", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "lead", type: "claude.leader" },
        { id: "worker", type: "claude.worker", parent: "lead" },
      ],
      edges: [],
    });
    expect(nodeOf(layout, "worker").rank).toBe(1);
    expect(layout.edges).toMatchObject([
      { from: "lead", to: "worker", kind: "owner" },
    ]);
  });

  it("adds no owner edge where a flow edge already joins them", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "lead", type: "claude.leader" },
        { id: "worker", type: "claude.worker", parent: "lead" },
      ],
      edges: [{ from: "lead", to: "worker" }],
    });
    expect(layout.edges.map(edge => edge.kind)).toEqual(["flow"]);
  });

  it("draws channels without letting them change the ranks", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "a", type: "claude.worker" },
        { id: "b", type: "claude.worker" },
      ],
      edges: [],
      channels: [["a", "b"]],
    });
    expect(nodeOf(layout, "a").rank).toBe(0);
    expect(nodeOf(layout, "b").rank).toBe(0);
    expect(layout.edges).toMatchObject([{ kind: "message" }]);
    expect(edgesThroughCards(layout)).toEqual([]);
  });

  it("ignores an edge to a node that is not there", () => {
    const layout = layoutGraph({
      nodes: [{ id: "a", type: "tool.shell" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    expect(layout.edges).toEqual([]);
  });

  it("makes a gap wide enough for a condition leaving across it", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "a", type: "tool.shell" },
        { id: "b", type: "tool.shell" },
      ],
      edges: [{ from: "a", to: "b", when: "verdict == 'escalate' here" }],
    });
    const a = nodeOf(layout, "a");
    const gap = nodeOf(layout, "b").x - (a.x + a.width);
    expect(gap).toBeGreaterThan(27 * LABEL_CHAR);
    expect(layout.edges[0]?.labelAt?.x).toBeCloseTo(a.x + a.width + gap / 2);
  });

  it("lines a first node up with the next, past a loop's lane beside it", () => {
    const layout = layoutGraph({
      nodes: ["pr", "build", "review", "ask"].map(id => ({
        id,
        type: "tool.shell",
      })),
      edges: [
        { from: "pr", to: "build", when: "json.state == 'OPEN'" },
        { from: "build", to: "review" },
        { from: "review", to: "pr", maxRounds: 3 },
        { from: "review", to: "ask" },
      ],
      channels: [],
    });
    const yOf = (id: string): number | undefined =>
      layout.nodes.find(node => node.id === id)?.y;
    expect(yOf("pr")).toBe(yOf("build"));
    const edge = layout.edges.find(({ from }) => from === "pr");
    expect(new Set(edge?.points.map(({ y }) => y)).size).toBe(1);
  });

  it("runs an edge straight across cards that overlap, not as a shallow S", () => {
    const layout = layoutGraph({
      nodes: ["a", "b", "c", "d"].map(id => ({ id, type: "tool.shell" })),
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
      channels: [],
    });
    expect(everyEdgeLevelOrApart(layout)).toBe(true);
  });

  it("joins neighboring ranks with one curve", () => {
    const layout = layoutGraph({
      nodes: [
        { id: "a", type: "tool.shell" },
        { id: "b", type: "tool.shell" },
        { id: "c", type: "tool.shell" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
    });
    expect(layout.edges.map(edge => edge.shape)).toEqual(["curve", "curve"]);
    expect(layout.edges.map(edge => edge.points.length)).toEqual([4, 4]);
  });

  it("runs a long edge level across the ranks it crosses", () => {
    const layout = layoutGraph({
      nodes: ["a", "b", "c", "d"].map(id => ({ id, type: "tool.shell" })),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "a", to: "d" },
      ],
    });
    expect(turnsOf(layout, "a", "d")).toBeLessThanOrEqual(4);
    expect(uprightRuns(layout, "a", "d")).toBeLessThanOrEqual(2);
  });

  it("orders a rank to remove crossings it can", () => {
    const layout = layoutGraph({
      nodes: ["a", "b", "x", "y"].map(id => ({ id, type: "tool.shell" })),
      edges: [
        { from: "a", to: "y" },
        { from: "b", to: "x" },
      ],
    });
    const heightOf = (id: string): number => nodeOf(layout, id).y;
    expect(heightOf("a") < heightOf("b")).toBe(heightOf("y") < heightOf("x"));
  });

  it("counts crossings", () => {
    expect(
      countCrossings(
        [
          ["a", "b"],
          ["x", "y"],
        ],
        [
          ["a", "y"],
          ["b", "x"],
        ],
      ),
    ).toBe(1);
  });
});
