/**
 * @file Tests for the Runs panel: it shows each run's state in words, filters
 *   by project, selects with the mouse and the keys as one tab stop, teaches
 *   the next step when empty, and re-renders only the row that changed.
 */

import type { RunView } from "@krapht/ork-server/client";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunRow } from "../../src/panels/run-row.tsx";
import { RunsPanel } from "../../src/panels/runs-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, project, renderPanel } from "./harness.tsx";

const onSelect = vi.fn<(id: string | null) => void>();

/** The run, telling `onRead` whenever a render reads its workflow. */
const readCounted = (run: RunView, onRead: () => void): RunView => ({
  ...run,
  get workflow() {
    onRead();
    return run.workflow;
  },
});

const Rows = ({ runs }: { runs: RunView[] }) => (
  <ul>
    {runs.map(run => (
      <RunRow
        key={run.id}
        onSelect={onSelect}
        run={run}
        selected={false}
        tabStop={false}
        waiting={false}
      />
    ))}
  </ul>
);

const rowNames = (): string[] =>
  within(screen.getByRole("list", { name: "Runs" }))
    .getAllByRole("button")
    .map(button => button.textContent);

const open = async (
  runs = [runView("aaa11111"), runView("bbb22222", "failed")],
) => {
  const opened = openPanelState({ projects: [project("shop")] });
  renderPanel(opened.state, <RunsPanel />);
  await act(async () => {
    opened.overview.send("runs", runs);
    opened.overview.send("decisions", []);
    await Promise.resolve();
  });
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

describe("the Runs panel", () => {
  it("says it is reading before the first frame", () => {
    renderPanel(openPanelState().state, <RunsPanel />);
    expect(screen.getByText("Reading runs…")).toBeDefined();
  });

  it("teaches the next step when there are no runs", async () => {
    await open([]);
    expect(screen.getByText("No runs yet.")).toBeDefined();
    expect(screen.getByText("ork run <workflow>")).toBeDefined();
  });

  it("shows each run's state in words, with its id and cost", async () => {
    await open();
    const [first, second] = rowNames();
    expect(first).toContain("running");
    expect(first).toContain("aaa11111");
    expect(first).toContain("$0.00");
    expect(second).toContain("failed");
  });

  it("has no accessibility violations", async () => {
    await open();
    expect(await violations(document.body)).toEqual([]);
  });

  it("says a run is waiting when a decision of its is open", async () => {
    const { overview } = await open();
    act(() => {
      overview.send("decisions", [
        {
          id: "d",
          runId: "aaa11111",
          node: "gate",
          kind: "question",
          question: "Ship?",
          options: [],
          openedAt: "2026-11-02T00:00:00.000Z",
          status: "open",
        },
      ]);
    });
    expect(rowNames()[0]).toContain("waiting on you");
    expect(rowNames()[1]).toContain("failed");
  });

  it("says how many nodes are paused in a running run", async () => {
    await open([
      { ...runView("aaa11111"), paused: { run: false, nodes: ["a", "b"] } },
    ]);
    expect(rowNames()[0]).toContain("2 nodes paused");
  });

  it("selects a run for the other panels, and marks it", async () => {
    const { state } = await open();
    await userEvent.click(screen.getByRole("button", { name: /bbb22222/u }));
    expect(state.selection.getValue().run).toBe("bbb22222");
    expect(
      screen
        .getByRole("button", { name: /bbb22222/u })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("is one tab stop, and the arrow keys move through it", async () => {
    const { state } = await open();
    const user = userEvent.setup();
    const first = screen.getByRole("button", { name: /aaa11111/u });
    const second = screen.getByRole("button", { name: /bbb22222/u });
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}{Enter}");
    expect(state.selection.getValue().run).toBe("bbb22222");
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it("filters by project, and says so when none match", async () => {
    const { state } = await open([
      { ...runView("aaa11111"), project: "/repos/shop" },
      { ...runView("bbb22222"), project: "/repos/other" },
    ]);
    act(() => {
      void state.runFilter.setValue("/repos/other");
    });
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("bbb22222");
    act(() => {
      void state.runFilter.setValue("/repos/gone");
    });
    expect(screen.getByText("No runs in this project.")).toBeDefined();
  });

  it("opens the Run workflow dialog", async () => {
    const { state } = await open();
    await userEvent.click(screen.getByRole("button", { name: "Run workflow" }));
    expect(state.runDialog.getValue()).toBe(true);
  });

  it("re-renders only the row of the run that changed", () => {
    const reads = { a: 0, b: 0 };
    const a = readCounted(runView("aaa11111"), () => {
      reads.a += 1;
    });
    const b = readCounted(runView("bbb22222"), () => {
      reads.b += 1;
    });
    const { rerender } = render(<Rows runs={[a, b]} />);
    reads.a = 0;
    reads.b = 0;
    rerender(<Rows runs={[a, { ...runView("bbb22222"), live: "paused" }]} />);
    expect(reads.a).toBe(0);
    rerender(<Rows runs={[a, b]} />);
    expect(reads.b).toBeGreaterThan(0);
  });
});
