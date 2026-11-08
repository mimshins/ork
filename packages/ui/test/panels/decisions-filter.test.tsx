/**
 * @file Tests for the Decisions panel's filter bar: each workflow and run with
 *   its count of open decisions, a choice hides the rest and says how many, the
 *   choice survives a reload, a saved value no longer present is dropped once
 *   the list has come, and an empty filter says so, not "nothing waits".
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionsPanel } from "../../src/panels/decisions-panel.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

const decision = (id: string, runId: string): DecisionRecord => ({
  id,
  runId,
  node: "gate",
  kind: "question",
  question: `Ask ${id}?`,
  options: [{ id: "yes" }, { id: "no" }],
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
});

const RUNS = [
  { ...runView("aaa11111"), workflow: "feature" },
  { ...runView("bbb22222"), workflow: "feature" },
  { ...runView("ccc33333"), workflow: "review" },
];

const LIST = [
  decision("d1", "aaa11111"),
  decision("d2", "aaa11111"),
  decision("d3", "bbb22222"),
  decision("d4", "ccc33333"),
];

const open = async (list: DecisionRecord[] = LIST) => {
  const opened = openPanelState();
  renderPanel(opened.state, <DecisionsPanel />);
  await act(async () => {
    opened.overview.send("runs", RUNS);
    opened.overview.send("decisions", list);
    await Promise.resolve();
  });
  return opened;
};

const choose = async (label: string, option: string): Promise<void> => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
};

/** Presses the first Clear filter there is: the bar's, or the empty state's. */
const clearFilter = async (): Promise<void> => {
  const [first] = screen.getAllByRole("button", { name: "Clear filter" });
  if (first !== undefined) await userEvent.click(first);
};

const asked = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-decision]")].map(
    card => card.dataset["decision"] ?? "",
  );

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the filter bar", () => {
  it("lists All and each workflow with its open decisions, and no bar for one run", async () => {
    await open();
    await choose("Workflow", "feature (3)");
    expect(asked()).toEqual(["d1", "d2", "d3"]);
    expect(
      screen.getByText("3 of 4 open decisions shown; 1 hidden by the filter."),
    ).toBeDefined();
    cleanup();
    localStorage.clear();
    await open([decision("d1", "aaa11111")]);
    expect(screen.queryByRole("combobox", { name: "Workflow" })).toBeNull();
  });

  it("keeps a workflow named all apart from All", async () => {
    const opened = openPanelState();
    renderPanel(opened.state, <DecisionsPanel />);
    await act(async () => {
      opened.overview.send("runs", [
        { ...runView("aaa11111"), workflow: "all" },
        { ...runView("bbb22222"), workflow: "feature" },
      ]);
      opened.overview.send("decisions", [
        decision("d1", "aaa11111"),
        decision("d2", "bbb22222"),
      ]);
      await Promise.resolve();
    });
    await choose("Workflow", "all (1)");
    expect(asked()).toEqual(["d1"]);
  });

  it("limits the runs to the chosen workflow, and ANDs the two", async () => {
    await open();
    await choose("Workflow", "feature (3)");
    await choose("Run", "bbb22222 · feature (1)");
    expect(asked()).toEqual(["d3"]);
    expect(screen.getByText(/1 of 4 open decisions shown/u)).toBeDefined();
  });

  it("says how many are open with no filter, and clears a filter", async () => {
    const user = userEvent.setup();
    await open();
    expect(screen.getByText("4 open decisions.")).toBeDefined();
    await choose("Workflow", "review (1)");
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(asked()).toHaveLength(4);
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Decisions" }),
    );
  });

  it("keeps the choice for the next visit", async () => {
    await open();
    await choose("Workflow", "review (1)");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    cleanup();
    await open();
    expect(asked()).toEqual(["d4"]);
  });

  it("drops a saved value that is no longer present, once the list has come", async () => {
    localStorage.setItem(
      "ork.preferences.v1",
      JSON.stringify({
        value: { decisionFilter: { workflow: "gone" } },
        timestamp: 0,
      }),
    );
    const opened = openPanelState();
    renderPanel(opened.state, <DecisionsPanel />);
    expect(opened.state.preferences.value.getValue().decisionFilter).toEqual({
      workflow: "gone",
    });
    await act(async () => {
      opened.overview.send("runs", RUNS);
      opened.overview.send("decisions", LIST);
      await Promise.resolve();
    });
    expect(asked()).toHaveLength(4);
    expect(opened.state.preferences.value.getValue().decisionFilter).toEqual(
      {},
    );
  });

  it("says the filter, not the queue, is empty", async () => {
    const { overview } = await open();
    await choose("Run", "ccc33333 · review (1)");
    await act(async () => {
      overview.send("decisions", [
        decision("d1", "aaa11111"),
        decision("d2", "bbb22222"),
      ]);
      await Promise.resolve();
    });
    expect(screen.getByText("No decisions match the filter.")).toBeDefined();
    expect(
      screen.getByText(/2 open decisions are hidden by it/u),
    ).toBeDefined();
    await clearFilter();
    expect(asked()).toEqual(["d1", "d2"]);
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Decisions" }),
    );
  });
});
