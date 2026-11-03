/**
 * @file Tests for the Monitor's accessibility on a fake server: what it says
 *   aloud, where the focus goes when a run opens or the node's controls close,
 *   the tree's chevrons and tab stop, and the edges said in words.
 */

import type { RunView, WorkflowGraph } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { type MonitorRoutes, openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

const GRAPH: WorkflowGraph = {
  nodes: [
    { id: "lead", type: "claude.leader" },
    { id: "kid", type: "claude.worker", parent: "lead" },
    { id: "kit", type: "workflow.call" },
  ],
  edges: [{ from: "lead", to: "kit", when: "ok" }],
  channels: [],
  positions: {},
};

const ROUTES: MonitorRoutes = {
  graph: GRAPH,
  tree: [
    treeNode("lead", {
      type: "claude.leader",
      state: "running",
      children: [treeNode("kid", { parent: "lead", state: "running" })],
    }),
    treeNode("kit", {
      type: "workflow.call",
      state: "running",
      calledRun: "called11",
    }),
  ],
};

const RUN = runView("aaa11111");
const CALLED = runView("called11");

const open = async (monitor: MonitorRoutes = ROUTES, run: RunView = RUN) => {
  const workspace = createWorkspace({ storage: localStorage, wide: true });
  const opened = openPanelState({ monitor });
  renderPanel(opened.state, <MonitorPanel />, workspace);
  await act(async () => {
    opened.overview.send("runs", [run, CALLED]);
    opened.overview.send("decisions", []);
    opened.state.selectRun(run.id);
    await Promise.resolve();
  });
  await screen.findByRole("treeitem", { name: /^lead,/u });
  return { ...opened, workspace };
};

const treeRow = (id: string): HTMLElement =>
  within(screen.getByRole("tree")).getByRole("treeitem", {
    name: new RegExp(`^${id},`, "u"),
  });

const graphCard = (id: string): HTMLElement =>
  within(screen.getByRole("application")).getByRole("button", {
    name: new RegExp(`^${id},`, "u"),
  });

const chevronOf = (row: HTMLElement): Element => {
  const chevron = row.firstElementChild;
  expect(chevron).not.toBeNull();
  return chevron ?? row;
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Monitor, for assistive tech", () => {
  it("says when the run changes, and not what it found on opening", async () => {
    const { overview, workspace } = await open(ROUTES, {
      ...RUN,
      live: "paused",
    });
    expect(workspace.announcement.getValue()).toBe("");
    await act(async () => {
      overview.send("runs", [RUN, CALLED]);
      await Promise.resolve();
    });
    await vi.waitFor(
      () => {
        expect(workspace.announcement.getValue()).toBe("Run aaa11111 running.");
      },
      { timeout: 3000 },
    );
  });

  it("takes the focus to the heading of a run opened from inside", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(treeRow("kit"));
    await user.click(screen.getByRole("button", { name: "Open run called11" }));
    await vi.waitFor(() => {
      expect(document.activeElement?.tagName).toBe("H2");
    });
  });

  it("leaves the focus alone when a run is chosen elsewhere", async () => {
    const { state } = await open();
    const row = treeRow("lead");
    row.focus();
    await act(async () => {
      state.selectRun(CALLED.id);
      await Promise.resolve();
    });
    expect(document.activeElement?.tagName).not.toBe("H2");
  });

  it("goes back to the node from its controls with Escape", async () => {
    const user = userEvent.setup();
    await open();
    treeRow("kit").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const section = await screen.findByRole("region", { name: "Node kit" });
    await vi.waitFor(() => {
      expect(section.contains(document.activeElement)).toBe(true);
    });
    // The first closes the tip that focus opened, as a tip's Escape should.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(treeRow("kit"));
  });

  it("stays in the controls when Escape closes the Stop dialog", async () => {
    const user = userEvent.setup();
    await open();
    treeRow("kit").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const section = await screen.findByRole("region", { name: "Node kit" });
    await vi.waitFor(() => {
      expect(section.contains(document.activeElement)).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Stop kit" }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(document.activeElement).not.toBe(treeRow("kit"));
  });

  it("groups the controls without promising a toolbar's keys", async () => {
    await open();
    expect(screen.getByRole("group", { name: "Run controls" })).toBeDefined();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("opens and closes a row with its chevron, without selecting it", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    await user.click(chevronOf(treeRow("lead")));
    expect(screen.queryByRole("treeitem", { name: /^kid,/u })).toBeNull();
    expect(treeRow("lead").getAttribute("aria-expanded")).toBe("false");
    expect(state.selection.getValue().node).toBeNull();
    await user.click(chevronOf(treeRow("lead")));
    expect(treeRow("kid")).toBeDefined();
  });

  it("makes a node selected in the graph the row Tab reaches", async () => {
    const user = userEvent.setup();
    await open();
    expect(treeRow("lead").tabIndex).toBe(0);
    await user.click(graphCard("kit"));
    expect(treeRow("kit").tabIndex).toBe(0);
    expect(treeRow("lead").tabIndex).toBe(-1);
  });

  it("says each node's edges, with their conditions", async () => {
    await open();
    expect(treeRow("lead").getAttribute("aria-description")).toBe(
      "leads to kit if ok; owns kid",
    );
    expect(graphCard("kit").getAttribute("aria-description")).toBe(
      "after lead if ok. CLI: ork logs aaa11111 --node kit",
    );
  });
});
