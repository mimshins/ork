/**
 * @file Tests for a task label on the graph's node card: a third muted line
 *   only when the node has one, named in the card's accessible name and shown
 *   whole in its tooltip.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import type { NodeFacts } from "../../src/graph/facts.ts";
import { GraphView } from "../../src/graph/graph-view.tsx";
import { layoutGraph } from "../../src/graph/layout.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";

const LABEL = `fix ${"a".repeat(76)}`;

const LAYOUT = layoutGraph({
  nodes: [
    { id: "build", type: "agent.worker" },
    { id: "plain", type: "agent.worker" },
  ],
  edges: [{ from: "build", to: "plain" }],
});

const FACTS = new Map<string, NodeFacts>([
  [
    "build",
    {
      status: "running",
      description: LABEL,
      cli: "ork logs r --node build",
    },
  ],
  ["plain", { status: "queued", description: "" }],
]);

const renderGraph = () =>
  render(
    <TipProvider>
      <GraphView
        facts={FACTS}
        label="Run"
        layout={LAYOUT}
      />
    </TipProvider>,
  );

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a node's card with a label", () => {
  it("shows the label as a line and names the card by it", () => {
    renderGraph();
    const build = screen.getByRole("button", { name: /^build,/u });
    expect(build.textContent).toContain(LABEL);
    expect(build.getAttribute("aria-label")).toBe(
      `build, ${LABEL}, running, worker`,
    );
  });

  it("shows the whole label in its tooltip", async () => {
    renderGraph();
    await userEvent
      .setup()
      .hover(screen.getByRole("button", { name: /^build,/u }));
    expect(await screen.findByText(`${LABEL} · running`)).toBeDefined();
  });

  it("has no label line without one, and keeps its name", () => {
    renderGraph();
    const plain = screen.getByRole("button", { name: /^plain,/u });
    expect(plain.querySelector("[class*='cardLabel']")).toBeNull();
    expect(plain.getAttribute("aria-label")).toBe("plain, queued, worker");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderGraph();
    expect(await violations(container)).toEqual([]);
  });
});
