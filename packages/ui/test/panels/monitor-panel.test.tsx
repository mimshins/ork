/**
 * @file Tests for the Monitor on a fake server: it shows the chosen run's graph
 *   and tree, follows the run's stream, sends the controls, asks before a stop,
 *   says why a control does not apply, moves through the tree with the keys,
 *   and follows calls and links to other runs.
 */

import type { RunView, WorkflowGraph } from "@krapht/ork-server/client";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { violations } from "../axe.ts";
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
  edges: [{ from: "lead", to: "kit" }],
  channels: [],
  positions: {},
};

const routes = (): MonitorRoutes => ({
  graph: GRAPH,
  tree: [
    treeNode("lead", {
      type: "claude.leader",
      state: "running",
      model: "opus",
      children: [treeNode("kid", { parent: "lead", state: "running" })],
    }),
    treeNode("kit", {
      type: "workflow.call",
      state: "running",
      calledRun: "called11",
    }),
  ],
});

const open = async (
  monitor: MonitorRoutes = routes(),
  run: RunView = runView("aaa11111"),
  others: RunView[] = [],
) => {
  const opened = openPanelState({ monitor });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [run, ...others]);
    opened.overview.send("decisions", []);
    opened.state.selectRun(run.id);
    await Promise.resolve();
  });
  await screen.findByRole("application");
  await screen.findByRole("treeitem", { name: /^lead,/u });
  return opened;
};

const treeRow = (id: string): HTMLElement =>
  within(screen.getByRole("tree")).getByRole("treeitem", {
    name: new RegExp(`^${id},`, "u"),
  });

const graphCard = (id: string): HTMLElement =>
  within(screen.getByRole("application")).getByRole("button", {
    name: new RegExp(`^${id},`, "u"),
  });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Monitor", () => {
  it("asks for a run when none is chosen", () => {
    renderPanel(openPanelState().state, <MonitorPanel />);
    expect(screen.getByText("No run chosen.")).toBeDefined();
  });

  it("shows the run's graph and its ownership tree", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "w" })).toBeDefined();
    expect(graphCard("lead").getAttribute("aria-label")).toBe(
      "lead, running, opus, leader",
    );
    expect(treeRow("kid").getAttribute("aria-level")).toBe("2");
    expect(treeRow("kit").getAttribute("aria-level")).toBe("1");
  });

  it("follows the run's stream", async () => {
    const monitor = routes();
    const { sources } = await open(monitor);
    monitor.tree = [
      treeNode("lead", {
        type: "claude.leader",
        state: "ok",
        costUsd: 0.25,
      }),
    ];
    const stream = await vi.waitFor(() => {
      const source = sources.last();
      expect(source.url).toContain("/api/runs/aaa11111/stream");
      return source;
    });
    act(() => {
      stream.send("run-event", {
        runId: "aaa11111",
        seq: 9,
        at: "now",
        event: { type: "run.resumed", kept: [] },
      });
    });
    await vi.waitFor(
      () => {
        expect(treeRow("lead").getAttribute("aria-label")).toBe(
          "lead, succeeded, $0.2500, leader",
        );
      },
      { timeout: 2000 },
    );
  });

  it("pauses at once, and sends it only to the server", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    await user.click(screen.getByRole("button", { name: "Pause run" }));
    await vi.waitFor(() => {
      expect(controlled).toEqual([
        { kind: "pause", run: "aaa11111", body: {} },
      ]);
    });
    // The change comes back on the stream, so nothing moved yet.
    expect(screen.getByRole("button", { name: "Pause run" })).toBeDefined();
  });

  it("asks before a stop", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    await user.click(screen.getByRole("button", { name: "Stop run" }));
    expect(controlled).toEqual([]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Stop run" }));
    await vi.waitFor(() => {
      expect(controlled).toEqual([{ kind: "stop", run: "aaa11111", body: {} }]);
    });
  });

  it("says why a control does not apply, and keeps it where the keys reach", async () => {
    await open();
    const proceed = screen.getByRole("button", {
      name: "Continue run: the run is not paused",
    });
    expect(proceed.getAttribute("aria-disabled")).toBe("true");
    proceed.focus();
    expect(document.activeElement).toBe(proceed);
  });

  it("disables every control of a run that has ended", async () => {
    await open(routes(), runView("aaa11111", "failed"));
    const why = "the run has ended (failed)";
    for (const word of ["Pause", "Continue", "Stop"]) {
      expect(
        screen
          .getByRole("button", { name: `${word} run: ${why}` })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });

  it("shows a refused control as a toast", async () => {
    const user = userEvent.setup();
    await open({ ...routes(), refuse: "It has gone." });
    await user.click(screen.getByRole("button", { name: "Pause run" }));
    expect(await screen.findByText("Could not pause run")).toBeDefined();
    expect(screen.getByText("It has gone.")).toBeDefined();
  });

  it("selects a node from the graph or the tree, and shows its controls", async () => {
    const user = userEvent.setup();
    const { state, controlled } = await open();
    await user.click(graphCard("lead"));
    expect(state.selection.getValue().node).toBe("lead");
    expect(treeRow("lead").getAttribute("aria-selected")).toBe("true");
    await user.click(treeRow("kid"));
    expect(state.selection.getValue().node).toBe("kid");
    await user.click(screen.getByRole("button", { name: "Pause kid" }));
    await vi.waitFor(() => {
      expect(controlled).toEqual([
        { kind: "pause", run: "aaa11111", body: { node: "kid" } },
      ]);
    });
  });

  it("goes to a node's controls with the menu key", async () => {
    await open();
    fireEvent.keyDown(graphCard("kid"), { key: "ContextMenu" });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Pause kid" }),
      );
    });
  });

  it("moves through the tree with the keys, as one tab stop", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    const stops = screen
      .getAllByRole("treeitem")
      .filter(row => row.tabIndex === 0);
    expect(stops).toEqual([treeRow("lead")]);
    treeRow("lead").focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(treeRow("kid"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(treeRow("kit"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(treeRow("lead"));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(treeRow("kid"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(treeRow("lead"));
    await user.keyboard("{Enter}");
    expect(state.selection.getValue().node).toBe("lead");
  });

  it("closes and opens a node's part of the tree", async () => {
    const user = userEvent.setup();
    await open();
    treeRow("lead").focus();
    await user.keyboard("{ArrowLeft}");
    expect(treeRow("lead").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: /^kid,/u })).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(treeRow("lead").getAttribute("aria-expanded")).toBe("true");
    expect(treeRow("kid")).toBeDefined();
  });

  it("opens the run a call started", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    await user.click(treeRow("kit"));
    await user.click(screen.getByRole("button", { name: "Open run called11" }));
    expect(state.selection.getValue().run).toBe("called11");
  });

  it("goes back to the run that called this one", async () => {
    const user = userEvent.setup();
    const called: RunView = { ...runView("called11"), parent: "aaa11111" };
    const { state } = await open(routes(), called);
    await user.click(
      screen.getByRole("button", { name: "Called by aaa11111" }),
    );
    expect(state.selection.getValue().run).toBe("aaa11111");
  });

  it("lists the run's links, and opens the run at the other end", async () => {
    const user = userEvent.setup();
    const { state } = await open({
      ...routes(),
      links: [
        {
          id: 1,
          a: { run: "other111", node: "peer" },
          b: { run: "aaa11111", node: "lead" },
          messages: 2,
          maxMessages: 10,
          createdAt: "now",
        },
      ],
    });
    const links = await screen.findByRole("region", {
      name: "Links to other runs",
    });
    expect(links.textContent).toContain("lead ↔ other111/peer");
    expect(links.textContent).toContain("2/10");
    await user.click(within(links).getByRole("button", { name: "Open" }));
    expect(state.selection.getValue().run).toBe("other111");
  });

  it("has nothing for axe to find", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(treeRow("kit"));
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
