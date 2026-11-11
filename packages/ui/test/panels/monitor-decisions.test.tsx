/**
 * @file Tests for the Monitor's decisions control: a run with open decisions
 *   says how many wait and follows the count, a click filters the Decisions
 *   panel to the run and goes there, and a run with none has no button.
 */

import type { DecisionRecord, WorkflowGraph } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

const GRAPH: WorkflowGraph = {
  nodes: [{ id: "lead", type: "agent.leader" }],
  edges: [],
  channels: [],
};

const decision = (id: string, runId: string): DecisionRecord => ({
  id,
  runId,
  node: "lead",
  kind: "question",
  question: "Ok?",
  options: [{ id: "yes" }, { id: "no" }],
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
});

const open = async (list: DecisionRecord[]) => {
  const workspace = createWorkspace({ storage: localStorage, wide: true });
  const goTo = vi.spyOn(workspace, "goTo").mockImplementation(() => {});
  const opened = openPanelState({
    monitor: { graph: GRAPH, tree: [treeNode("lead", { state: "running" })] },
  });
  renderPanel(opened.state, <MonitorPanel />, workspace);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", list);
    opened.state.selectRun("aaa11111");
    await Promise.resolve();
  });
  await screen.findByRole("application");
  return { ...opened, goTo };
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Monitor's decisions control", () => {
  it("says how many wait on the run, and none for another run's", async () => {
    const { overview } = await open([
      decision("d1", "aaa11111"),
      decision("d2", "aaa11111"),
      decision("d3", "bbb22222"),
    ]);
    expect(
      screen.getByRole("button", { name: "2 decisions waiting" }),
    ).toBeDefined();
    await act(async () => {
      overview.send("decisions", [decision("d1", "aaa11111")]);
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "1 decision waiting" }),
    ).toBeDefined();
    await act(async () => {
      overview.send("decisions", [decision("d3", "bbb22222")]);
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: /waiting/u })).toBeNull();
  });

  it("filters Decisions to the run and goes there", async () => {
    const user = userEvent.setup();
    const { state, goTo } = await open([decision("d1", "aaa11111")]);
    await user.click(
      screen.getByRole("button", { name: "1 decision waiting" }),
    );
    expect(state.preferences.value.getValue().decisionFilter).toEqual({
      run: "aaa11111",
    });
    expect(goTo).toHaveBeenCalledWith("decisions");
  });
});
