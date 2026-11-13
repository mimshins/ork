/**
 * @file Tests for a task's `description` in the UI: the Logs line, the
 *   Monitor's tree row (text and name) and the node strip. A node without one
 *   shows exactly what it did before.
 */

import type {
  StoredEvent,
  TreeNode,
  WorkflowGraph,
} from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogsPanel } from "../../src/panels/logs-panel.tsx";
import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

type Event = StoredEvent["event"];

const at = "2026-11-03T00:00:00.000Z";

const started = (id: string, description?: string): Event => ({
  type: "node.started",
  id,
  nodeType: "agent.worker",
  round: 1,
  ...(description === undefined ? {} : { description }),
});

const stored = (seq: number, event: Event): StoredEvent => ({
  runId: "r",
  seq,
  at,
  event,
});

const openLogs = async (events: StoredEvent[]) => {
  const opened = openPanelState({ events });
  renderPanel(opened.state, <LogsPanel />);
  await act(async () => {
    opened.state.selectRun("r");
    await Promise.resolve();
  });
  await screen.findByRole("list", { name: "Events of run r" });
};

const logRows = (): HTMLElement[] =>
  within(screen.getByRole("list", { name: "Events of run r" })).getAllByRole(
    "button",
  );

const GRAPH: WorkflowGraph = {
  nodes: [{ id: "build.2", type: "agent.worker" }],
  edges: [],
  channels: [],
};

const openMonitor = async (tree: TreeNode[]) => {
  const opened = openPanelState({ monitor: { graph: GRAPH, tree } });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", []);
    opened.state.selectRun("aaa11111");
    await Promise.resolve();
  });
  await screen.findByRole("tree");
  return opened;
};

const row = (): HTMLElement =>
  within(screen.getByRole("tree")).getByRole("treeitem");

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a description in the Logs panel", () => {
  it("shows beside the line, and the node column stays the id", async () => {
    await openLogs([
      stored(1, started("build.2", "fix login redirect")),
      stored(2, started("plain")),
    ]);
    const [labelled, plain] = logRows().map(item => item.textContent);
    expect(labelled).toContain("build.2");
    expect(labelled).toContain("agent.worker · fix login redirect");
    expect(plain).not.toContain("·");
  });
});

describe("a description in the Monitor", () => {
  it("shows beside the id in the tree row, named second", async () => {
    await openMonitor([
      treeNode("build.2", {
        state: "running",
        description: "fix login redirect",
      }),
    ]);
    expect(within(row()).getByText("build.2")).toBeDefined();
    expect(within(row()).getByText("fix login redirect")).toBeDefined();
    expect(row().getAttribute("aria-label")).toMatch(
      /^build\.2, fix login redirect, running, /u,
    );
  });

  it("keeps an 80-character label in its cell, its name and its tip", async () => {
    const label = `fix ${"a".repeat(76)}`;
    await openMonitor([
      treeNode("build.2", { state: "running", description: label }),
    ]);
    const cell = within(row()).getByText(label);
    expect(cell.className).toContain("treeLabel");
    expect(row().getAttribute("aria-label")).toContain(label);
    const before = screen.getAllByText(label).length;
    await userEvent.setup().hover(cell);
    // The tip is one more copy of the label, in a popup.
    await vi.waitFor(() => {
      expect(screen.getAllByText(label).length).toBe(before + 1);
    });
  });

  it("leaves a node without one as it was", async () => {
    await openMonitor([treeNode("build.2", { state: "running" })]);
    expect(row().getAttribute("aria-label")).toMatch(/^build\.2, running, /u);
  });

  it("shows it under the id in the node strip", async () => {
    await openMonitor([
      treeNode("build.2", {
        state: "running",
        description: "fix login redirect",
      }),
    ]);
    await userEvent.setup().click(row());
    const strip = await screen.findByRole("region", { name: "Node build.2" });
    expect(within(strip).getByText("fix login redirect").tagName).toBe("P");
  });

  it("has no paragraph in the strip without one", async () => {
    await openMonitor([treeNode("build.2", { state: "running" })]);
    await userEvent.setup().click(row());
    const strip = await screen.findByRole("region", { name: "Node build.2" });
    expect(strip.querySelector("p")).toBeNull();
  });
});
