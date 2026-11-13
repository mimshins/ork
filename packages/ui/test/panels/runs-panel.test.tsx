/**
 * @file Tests for the Runs panel: it shows each run's state in words, narrows
 *   the list with the shared filter bar (the server's answer, its refusal said
 *   inline, Clear filter), selects with the mouse and the keys as one tab stop,
 *   teaches the next step when empty, and re-renders only the row that
 *   changed.
 */

import type { RunView, TriggersReport } from "@krapht/ork-server/client";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

const LIVE: TriggersReport["triggers"][number] = {
  project: "p",
  trigger: "new-issue",
  run: "triage",
  every: "5m",
  standing: "live",
  lookedAt: "2026-11-04T10:00:00Z",
  problems: [],
  warnings: [],
};

describe("the triggers under the runs", () => {
  it("says nothing when there are none", async () => {
    const { state } = openPanelState();
    renderPanel(state, <RunsPanel />);
    await waitFor(() => {
      expect(state.triggers.state.getValue().status).toBe("ready");
    });
    expect(screen.queryByRole("region", { name: "Triggers" })).toBeNull();
  });

  it("says what's live, what's off and what's in the way", async () => {
    const { state } = openPanelState({
      triggers: {
        pid: 7,
        broken: [],
        triggers: [
          { ...LIVE, held: "1 of its runs still going" },
          { ...LIVE, trigger: "fresh", standing: "new" },
        ],
      },
    });
    renderPanel(state, <RunsPanel />);
    expect(await screen.findByText("new-issue")).toBeDefined();
    expect(screen.getByText("Live")).toBeDefined();
    expect(screen.getByText(/^Waiting: 1 of its runs/u)).toBeDefined();
    expect(screen.getByText(/ork watch --accept/u)).toBeDefined();
    expect(screen.queryByText(/isn't running/u)).toBeNull();
  });

  it("says so when nothing is looking", async () => {
    const { state } = openPanelState({
      triggers: { broken: [], triggers: [LIVE] },
    });
    renderPanel(state, <RunsPanel />);
    expect(await screen.findByText(/isn't running/u)).toBeDefined();
  });

  it("offers no way to accept one: that takes a terminal", async () => {
    const { state } = openPanelState({
      triggers: {
        pid: 7,
        broken: [],
        triggers: [{ ...LIVE, standing: "new" }],
      },
    });
    renderPanel(state, <RunsPanel />);
    await screen.findByText("new-issue");
    // The command block's copy button names `ork watch --accept`; none accepts.
    expect(screen.queryByRole("button", { name: /^accept/iu })).toBeNull();
  });
});

/** A fake answer that refuses a filter naming `param`, and gives `rows` else. */
const refusing =
  <T,>(param: string, error: string, rows: T) =>
  (query: URLSearchParams): T | { error: string } =>
    query.has(param) ? { error } : rows;

type Asked = URLSearchParams[];

/** The panel on a server that answers each filter with `answer`. */
const openFiltered = async (
  answer: (query: URLSearchParams) => RunView[] | { error: string },
) => {
  const asked: Asked = [];
  const opened = openPanelState({
    projects: [project("shop")],
    runs: query => {
      asked.push(query);
      return answer(query);
    },
  });
  renderPanel(opened.state, <RunsPanel />);
  await act(async () => {
    opened.overview.send("runs", [runView("aaa11111"), runView("bbb22222")]);
    opened.overview.send("decisions", []);
    await Promise.resolve();
  });
  return { ...opened, asked };
};

const chooseStatus = async (name: string): Promise<void> => {
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Status" }),
  );
  await userEvent.click(await screen.findByRole("option", { name }));
};

describe("the Runs panel's filter bar", () => {
  it("shows the bar, and reads nothing from the server until a filter is set", async () => {
    const { asked } = await openFiltered(() => []);
    await screen.findByRole("combobox", { name: "Status" });
    screen.getByRole("search", { name: "Filter runs" });
    expect(rowNames()).toHaveLength(2);
    expect(asked).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });

  it("asks the server for the filter, shows its answer, the count and the command", async () => {
    const { asked } = await openFiltered(() => [runView("bbb22222", "failed")]);
    await chooseStatus("failed");
    await screen.findByText("1 run matches.");
    expect(asked.at(-1)?.get("status")).toBe("failed");
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("bbb22222");
    screen.getByRole("button", {
      name: "Copy command (ork ps --status failed)",
    });
  });

  it("says so when the filter matches nothing", async () => {
    await openFiltered(() => []);
    await chooseStatus("paused");
    await screen.findByText("No runs match the filter.");
    expect(screen.queryByRole("list", { name: "Runs" })).toBeNull();
  });

  it("shows the server's refusal inline, and keeps the last good rows", async () => {
    await openFiltered(
      refusing("workflow", "--workflow takes a workflow name, not `x y`.", [
        runView("bbb22222", "failed"),
      ]),
    );
    await chooseStatus("failed");
    await screen.findByText("1 run matches.");
    await userEvent.type(
      screen.getByRole("combobox", { name: "Workflow" }),
      "x y{Enter}",
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "--workflow takes a workflow name, not x y.",
    );
    expect(rowNames()).toHaveLength(1);
  });

  it("clears the filter, and shows the stream's runs again", async () => {
    const { asked } = await openFiltered(() => [runView("bbb22222", "failed")]);
    await chooseStatus("failed");
    await screen.findByText("1 run matches.");
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => {
      expect(rowNames()).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    const before = asked.length;
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toHaveLength(before);
  });

  it("keeps its filter when the panel is mounted again", async () => {
    const { state } = await openFiltered(() => [runView("bbb22222", "failed")]);
    await chooseStatus("failed");
    await screen.findByText("1 run matches.");
    cleanup();
    renderPanel(state, <RunsPanel />);
    await screen.findByText("1 run matches.");
    expect(state.runFilter.getValue()).toEqual({ status: "failed" });
  });
});
