/**
 * @file Tests for how the Monitor says a node ended: the selected node's strip
 *   has its end note, a stopped run lists the nodes that did not end well and a
 *   line picks its node, and a run still going, or a node that finished well,
 *   shows none.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitorPanel } from "../../src/panels/monitor-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { DONE, OUT_OF_CREDITS, RATE_LIMITED, TURN_LIMIT } from "../ends.ts";
import { runView } from "../state/fixtures.ts";
import { type MonitorRoutes, openPanelState, renderPanel } from "./harness.tsx";
import { treeNode } from "./monitor-fixtures.ts";

const failed = (id: string, end: typeof TURN_LIMIT, at: string) =>
  treeNode(id, { state: "failed", end, finishedAt: at });

const routes = (): MonitorRoutes => ({
  graph: {
    nodes: ["a", "b", "c", "d", "ok"].map(id => ({
      id,
      type: "claude.worker",
    })),
    edges: [],
    channels: [],
  },
  tree: [
    failed("a", TURN_LIMIT, "2026-11-02T00:00:04.000Z"),
    failed("b", RATE_LIMITED, "2026-11-02T00:00:01.000Z"),
    failed(
      "c",
      { ...OUT_OF_CREDITS, detail: "no credit" },
      "2026-11-02T00:00:02.000Z",
    ),
    failed("d", TURN_LIMIT, "2026-11-02T00:00:03.000Z"),
    treeNode("ok", { state: "ok", end: DONE }),
  ],
});

const open = async (run: ReturnType<typeof runView>) => {
  const opened = openPanelState({ monitor: routes() });
  renderPanel(opened.state, <MonitorPanel />);
  await act(async () => {
    opened.overview.send("runs", [run]);
    opened.overview.send("decisions", []);
    opened.state.selectRun(run.id);
    await Promise.resolve();
  });
  await screen.findByRole("application");
  await screen.findByRole("treeitem", { name: /^a,/u });
  return opened;
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("why a run stopped", () => {
  it("lists nodes in the order they ended, three first, and picks one", async () => {
    const { state } = await open(runView("aaa11111", "failed"));
    const section = screen.getByRole("region", { name: "Why the run stopped" });
    const rows = within(section).getAllByRole("button", { name: /^Select /u });
    expect(rows.map(row => row.getAttribute("aria-label"))).toEqual([
      "Select b: Rate limited, may pass, was asked by its provider to slow down",
      "Select c: Out of credits, found no credit left on its account",
      "Select d: Turn limit, reached its turn limit (8)",
    ]);
    const more = within(section).getByRole("button", { name: "Show 1 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(more);
    expect(
      within(section).getAllByRole("button", { name: /^Select /u }),
    ).toHaveLength(4);
    await userEvent.click(
      within(section).getByRole("button", { name: /^Select d:/u }),
    );
    expect(state.selection.getValue().node).toBe("d");
    await userEvent.click(
      within(section).getByRole("button", { name: "Show fewer" }),
    );
    expect(
      within(section).getAllByRole("button", { name: /^Select /u }),
    ).toHaveLength(3);
  });

  it("is not there while the run is going", async () => {
    await open(runView("aaa11111", "running"));
    expect(
      screen.queryByRole("region", { name: "Why the run stopped" }),
    ).toBeNull();
  });
});

describe("a node's strip", () => {
  it("has the end note of a node that did not end well, and passes axe", async () => {
    const { state } = await open(runView("aaa11111", "failed"));
    await act(async () => {
      state.selectNode("b");
      await Promise.resolve();
    });
    const strip = screen.getByRole("region", { name: "Node b" });
    const note = within(strip).getByRole("group", { name: "How b ended" });
    expect(note.textContent).toContain("Rate limited");
    expect(note.textContent).toContain("may pass");
    await userEvent.click(
      within(note).getByRole("button", { name: "Details" }),
    );
    expect(await violations(document.body)).toEqual([]);
  });

  it("closes Details when another node is selected", async () => {
    const { state } = await open(runView("aaa11111", "failed"));
    await act(async () => {
      state.selectNode("b");
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(
      screen
        .getByRole("button", { name: "Details" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () => {
      state.selectNode("c");
      await Promise.resolve();
    });
    expect(
      screen
        .getByRole("button", { name: "Details" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("has none for a node that finished well", async () => {
    const { state } = await open(runView("aaa11111", "failed"));
    await act(async () => {
      state.selectNode("ok");
      await Promise.resolve();
    });
    const strip = screen.getByRole("region", { name: "Node ok" });
    expect(
      within(strip).queryByRole("group", { name: /How ok ended/u }),
    ).toBeNull();
  });
});
