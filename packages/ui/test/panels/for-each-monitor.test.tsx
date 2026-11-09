/**
 * @file Tests for a node with `forEach` in the Monitor: one card that says its
 *   progress, its items as rows that take the tree's keys, and the card marked
 *   when one of its items is selected.
 */

import type { WorkflowGraph } from "@krapht/ork-server/client";
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
import { openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

const GRAPH: WorkflowGraph = {
  nodes: [
    { id: "build", type: "claude.worker" },
    { id: "after", type: "control.join" },
  ],
  edges: [{ from: "build", to: "after" }],
  channels: [],
};

const item = (index: number, state: "ok" | "failed" | "running") =>
  treeNode(`build.${String(index)}`, { template: "build", state });

const open = async () => {
  const monitor = {
    graph: GRAPH,
    tree: [
      treeNode("build", {
        state: "running",
        listed: 8,
        children: [item(0, "ok"), item(1, "failed"), item(2, "ok")],
      }),
      treeNode("after"),
    ],
  };
  const opened = openPanelState({ monitor });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111")]);
    opened.overview.send("decisions", []);
    opened.state.selectRun("aaa11111");
    await Promise.resolve();
  });
  await screen.findByRole("application");
  await screen.findByRole("treeitem", { name: /^build,/u });
  return opened;
};

const treeRow = (id: string): HTMLElement =>
  within(screen.getByRole("tree")).getByRole("treeitem", {
    name: new RegExp(`^${id.replace(".", "\\.")},`, "u"),
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

describe("the Monitor with a node with forEach", () => {
  it("draws one card that says its progress, in its name too", async () => {
    await open();
    expect(graphCard("build").getAttribute("aria-label")).toBe(
      "build, running, 3 of 8, 1 failed, worker",
    );
    expect(graphCard("build").textContent).toContain("3 of 8, 1 failed");
    expect(screen.queryByRole("button", { name: /^build\.0,/u })).toBeNull();
  });

  it("keeps the status word in the card's tip, as the card shows progress", async () => {
    await open();
    act(() => {
      graphCard("build").focus();
    });
    expect(await screen.findByText("running · 3 of 8, 1 failed")).toBeTruthy();
  });

  it("lists the items as child rows that take the tree's keys", async () => {
    const user = userEvent.setup();
    await open();
    expect(treeRow("build.2").getAttribute("aria-level")).toBe("2");
    expect(treeRow("build").getAttribute("aria-expanded")).toBe("true");
    treeRow("build").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(treeRow("build.0"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(treeRow("after"));
    await user.keyboard("{Home}{ArrowDown}{ArrowDown}{ArrowLeft}");
    expect(document.activeElement).toBe(treeRow("build"));
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: /^build\.0,/u })).toBeNull();
  });

  it("says a failed item in words", async () => {
    await open();
    expect(treeRow("build.1").getAttribute("aria-label")).toContain("failed");
  });

  it("shows a selected item's strip and marks its node's card", async () => {
    const user = userEvent.setup();
    const { state } = await open();
    await user.click(treeRow("build.1"));
    expect(state.selection.getValue().node).toBe("build.1");
    const strip = screen.getByRole("region", { name: "Node build.1" });
    expect(strip.textContent).toContain("of build, index 1");
    expect(strip.textContent).toContain("ork logs aaa11111 --node build.1");
    expect(Object.hasOwn(graphCard("build").dataset, "holding")).toBe(true);
    expect(graphCard("build").getAttribute("aria-current")).toBeNull();
    expect(treeRow("build.1").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(treeRow("build"));
    expect(
      within(screen.getByRole("region", { name: "Node build" })).getByText(
        "3 of 8, 1 failed",
      ),
    ).toBeDefined();
  });

  it("has nothing for axe to find", async () => {
    await open();
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
