/**
 * @file Tests for the graph's view: one tab stop among the cards, moving along
 *   edges with the arrow keys, selecting, the node menu key, accessible names,
 *   the view's keys and controls, and what axe finds.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import type { NodeFacts } from "../../src/graph/facts.ts";
import { GraphView, type GraphViewProps } from "../../src/graph/graph-view.tsx";
import { layoutGraph } from "../../src/graph/layout.ts";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";

const LAYOUT = layoutGraph({
  nodes: [
    { id: "start", type: "claude.leader" },
    { id: "top", type: "tool.shell" },
    { id: "bottom", type: "workflow.call" },
    { id: "end", type: "human.gate" },
  ],
  edges: [
    { from: "start", to: "top" },
    { from: "start", to: "bottom" },
    { from: "top", to: "end", when: "exitCode == 0" },
    { from: "bottom", to: "end" },
    { from: "end", to: "start", maxRounds: 2 },
  ],
});

const FACTS = new Map<string, NodeFacts>([
  ["start", { status: "running", model: "opus", tokens: 1200, costUsd: 0.25 }],
  ["top", { status: "failed" }],
]);

const show = (props: Partial<GraphViewProps> = {}) =>
  render(
    <TipProvider>
      <GraphView
        facts={FACTS}
        label="Run 4f2a1c"
        layout={LAYOUT}
        {...props}
      />
    </TipProvider>,
  );

const card = (id: string): HTMLElement =>
  screen.getByRole("button", { name: new RegExp(`^${id},`, "u") });

const canvas = (): HTMLElement => screen.getByRole("application");

/** The transform the view has written, once its frame has run. */
const transformOf = async (element: Element | null): Promise<string> => {
  await vi.waitFor(() => {
    expect(element).toHaveProperty(
      "style.transform",
      expect.stringContaining("scale"),
    );
  });
  return element instanceof HTMLElement ? element.style.transform : "";
};

/** The text that describes an element. */
const hintOf = (element: Element): string | null | undefined =>
  document.querySelector(
    `[id="${element.getAttribute("aria-describedby") ?? ""}"]`,
  )?.textContent;

const layerOf = (root: HTMLElement): Element | null =>
  root.querySelector("[data-graph-node]")?.parentElement ?? null;

describe("the graph", () => {
  beforeEach(() => {
    stubWindow();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names each node with its id, type, status, model, tokens and cost", () => {
    show();
    expect(card("start").getAttribute("aria-label")).toBe(
      "start, leader, running, opus, 1200 tokens, $0.2500",
    );
    expect(card("top").getAttribute("aria-label")).toBe(
      "top, shell tool, failed",
    );
    expect(card("bottom").getAttribute("aria-label")).toBe(
      "bottom, workflow call, queued",
    );
  });

  it("shows each node's status in a word too", () => {
    show();
    expect(card("top").textContent).toContain("failed");
    expect(card("start").textContent).toContain("1.2k tok");
  });

  it("has one tab stop among its cards, the selected one", () => {
    show({ selected: "end" });
    const tabbable = ["start", "top", "bottom", "end"].filter(
      id => card(id).tabIndex === 0,
    );
    expect(tabbable).toEqual(["end"]);
    expect(card("end").getAttribute("aria-current")).toBe("true");
  });

  it("tabs from the canvas to the first card", async () => {
    const user = userEvent.setup();
    show();
    await user.tab();
    expect(document.activeElement).toBe(canvas());
    await user.tab();
    expect(document.activeElement).toBe(card("start"));
  });

  it("moves along edges with the arrow keys, and the tab stop follows", async () => {
    const user = userEvent.setup();
    show();
    card("start").focus();
    await user.keyboard("{ArrowRight}");
    const moved = document.activeElement;
    expect([card("top"), card("bottom")]).toContain(moved);
    expect(moved).toHaveProperty("tabIndex", 0);
    expect(card("start").tabIndex).toBe(-1);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(card("end"));
    await user.keyboard("{ArrowLeft}");
    expect([card("top"), card("bottom")]).toContain(document.activeElement);
  });

  it("stays put where no edge goes that way", async () => {
    const user = userEvent.setup();
    show();
    card("end").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(card("end"));
  });

  it("selects with Enter", async () => {
    const onSelect = vi.fn<(id: string) => void>();
    const user = userEvent.setup();
    show({ onSelect });
    card("top").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("top");
  });

  it("selects with a click", async () => {
    const onSelect = vi.fn<(id: string) => void>();
    const user = userEvent.setup();
    show({ onSelect });
    await user.click(card("bottom"));
    expect(onSelect).toHaveBeenCalledWith("bottom");
  });

  it("asks for a node's controls with the menu keys and a right click", () => {
    const onNodeMenu = vi.fn<(id: string) => void>();
    show({ onNodeMenu });
    fireEvent.keyDown(card("top"), { key: "ContextMenu" });
    fireEvent.keyDown(card("end"), { key: "F10", shiftKey: true });
    fireEvent.contextMenu(card("start"));
    expect(onNodeMenu.mock.calls.flat()).toEqual(["top", "end", "start"]);
  });

  it("goes back to the canvas with Escape", async () => {
    const user = userEvent.setup();
    show();
    card("top").focus();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(canvas());
  });

  it("moves the view with the arrow keys on the canvas", async () => {
    const { container } = show();
    const layer = layerOf(container);
    const before = await transformOf(layer);
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    await vi.waitFor(() => {
      expect(layer).not.toHaveProperty("style.transform", before);
    });
    expect(document.activeElement).not.toBe(card("start"));
  });

  it("zooms with its buttons and its keys, and fits again", async () => {
    const { container } = show();
    const layer = layerOf(container);
    const fitted = await transformOf(layer);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Zoom in" }));
    await vi.waitFor(() => {
      expect(layer).not.toHaveProperty("style.transform", fitted);
    });
    fireEvent.keyDown(canvas(), { key: "0" });
    await vi.waitFor(() => {
      expect(layer).toHaveProperty("style.transform", fitted);
    });
    fireEvent.keyDown(canvas(), { key: "+" });
    await vi.waitFor(() => {
      expect(layer).not.toHaveProperty("style.transform", fitted);
    });
  });

  it("leaves the browser's own zoom keys alone", () => {
    show();
    const event = new KeyboardEvent("keydown", {
      key: "0",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    canvas().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("names the graph and describes its keys", () => {
    show();
    const graph = canvas();
    expect(graph.getAttribute("aria-label")).toBe("Run 4f2a1c");
    expect(graph.getAttribute("aria-roledescription")).toBe("graph");
    expect(hintOf(graph)).toContain("0 fits the graph");
  });

  it("has nothing for axe to find", async () => {
    const { container } = show({ selected: "top" });
    await expect(violations(container)).resolves.toEqual([]);
  });
});
