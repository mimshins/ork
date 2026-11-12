/**
 * @file Tests for a node with no price on the graph (RFC-015): its card shows
 *   counted tokens where the dollars would be, never both, and its accessible
 *   name says it has no price.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import type { NodeFacts } from "../../src/graph/facts.ts";
import { GraphView } from "../../src/graph/graph-view.tsx";
import { layoutGraph } from "../../src/graph/layout.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LAYOUT = layoutGraph({
  nodes: [
    { id: "scan", type: "agent.worker" },
    { id: "ship", type: "agent.worker" },
  ],
  edges: [{ from: "scan", to: "ship" }],
});

const FACTS = new Map<string, NodeFacts>([
  [
    "scan",
    { status: "succeeded", tokens: 12_300, unpriced: true, costUsd: undefined },
  ],
  ["ship", { status: "succeeded", tokens: 800, costUsd: 0.5 }],
]);

describe("a node's card", () => {
  it("shows tokens in place of dollars for a node with no price, never both", () => {
    render(
      <TipProvider>
        <GraphView
          facts={FACTS}
          label="Run"
          layout={LAYOUT}
        />
      </TipProvider>,
    );
    const scan = screen.getByRole("button", { name: /^scan,/u });
    expect(scan.textContent).toContain("12.3k tok");
    expect(scan.textContent).not.toContain("$");
    expect(scan.getAttribute("aria-label")).toContain("no price");
    const ship = screen.getByRole("button", { name: /^ship,/u });
    expect(ship.textContent).toContain("$0.5000");
    expect(ship.textContent).not.toContain("tok");
  });

  it("has no accessibility violations on a card with no price", async () => {
    const { container } = render(
      <TipProvider>
        <GraphView
          facts={FACTS}
          label="Run"
          layout={LAYOUT}
        />
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });
});
