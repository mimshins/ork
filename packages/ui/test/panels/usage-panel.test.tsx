/**
 * @file Tests for the Usage panel and its model: totals, hints and breakdowns
 *   from the report, asking the server for the project and period chosen, a
 *   refusal and an empty period said in words, and a series with its gaps
 *   filled, by week once it is long.
 */

import type { UsageAnswer, UsageReport } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  money,
  moneyOf,
  seriesOf,
  sinceOf,
  usageCommand,
} from "../../src/panels/usage-model.ts";
import { UsagePanel } from "../../src/panels/usage-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import {
  type FakeRoutes,
  openPanelState,
  project,
  renderPanel,
} from "./harness.tsx";

type Group = UsageReport["groups"]["day"][number];

const group = (key: string, costUsd: number): Group => ({
  key,
  costUsd,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 300,
  cacheWriteTokens: 0,
  turns: 4,
  durationMs: 1000,
  sessions: 2,
  runs: 1,
  failedUsd: 0,
  reworkUsd: 0,
  chatUsd: 0,
  cacheHitRate: 0.75,
  cpuMs: 0,
});

const report = (extra: Partial<UsageAnswer> = {}): UsageAnswer => ({
  totals: group("", 12.5),
  limits: { problems: [], caps: [], plan: [] },
  groups: {
    day: [group("2026-11-01", 2), group("2026-11-03", 10.5)],
    week: [group("2026-10-26", 2), group("2026-11-02", 10.5)],
    month: [group("2026-11", 12.5)],
    workflow: [group("ship", 12.5)],
    node: [group("ship/build", 12.5)],
    model: [group("claude-sonnet-5-5", 12.5)],
    driver: [group("cli", 12.5)],
    project: [group("/repos/shop", 12.5)],
  },
  hints: [{ code: "rework", message: "A lot went to loop rounds." }],
  ...extra,
});

const settle = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

const open = async (routes?: FakeRoutes) => {
  const opened = openPanelState({
    projects: [project("shop")],
    ...(routes ?? { usage: () => report() }),
  });
  const { container } = renderPanel(opened.state, <UsagePanel />);
  await act(async () => {
    opened.overview.send("runs", []);
    await settle();
  });
  return { ...opened, container };
};

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Usage panel", () => {
  it("shows the totals, the hints and where the spend went", async () => {
    const { container } = await open();
    expect(screen.getByText("Spend").nextSibling?.textContent).toBe("$12.50");
    expect(
      screen.getByText("From cache", { selector: "dt" }).nextSibling
        ?.textContent,
    ).toBe("75%");
    screen.getByText("A lot went to loop rounds.");
    const models = screen.getByRole("region", { name: "By model" });
    within(models).getByRole("rowheader", { name: "claude-sonnet-5-5" });
    expect(
      screen.getByRole("region", { name: "Costliest nodes" }).textContent,
    ).toContain("ship/build");
    screen.getByRole("img", { name: /The peak was \$10\.50 on 2026-11-03/u });
    expect(await violations(container)).toEqual([]);
  });

  it("asks for all projects over 30 days to begin with, by project when all", async () => {
    const asked: URLSearchParams[] = [];
    await open({
      usage: query => {
        asked.push(query);
        return report();
      },
    });
    expect(asked[0]?.has("project")).toBe(false);
    expect(asked[0]?.has("since")).toBe(true);
    screen.getByRole("region", { name: "By project" });
  });

  it("asks again for the period chosen", async () => {
    const asked: URLSearchParams[] = [];
    await open({
      usage: query => {
        asked.push(query);
        return report();
      },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "All time" }),
    );
    expect(asked.at(-1)?.has("since")).toBe(false);
  });

  it("reads again when a run ends", async () => {
    const asked: URLSearchParams[] = [];
    const { overview } = await open({
      usage: query => {
        asked.push(query);
        return report();
      },
    });
    const before = asked.length;
    await act(async () => {
      overview.send("runs", [runView("aaa11111", "succeeded")]);
      await settle();
    });
    expect(asked.length).toBe(before + 1);
  });

  it("shows each limit, and a plan limit in force", async () => {
    await open({
      usage: () =>
        report({
          limits: {
            problems: [],
            caps: [
              {
                window: "day",
                capUsd: 20,
                spentUsd: 5,
                leftUsd: 15,
                resetsAt: "2030-01-01T00:00:00.000Z",
              },
            ],
            plan: [
              {
                status: "rejected",
                window: "five_hour",
                at: "2029-12-31T20:00:00.000Z",
              },
            ],
          },
        }),
    });
    expect(
      screen.queryByRole("meter", { name: "All projects, this day" }),
    ).not.toBeNull();
    expect(
      screen.queryByText("Your Claude plan's five hour limit was reached."),
    ).not.toBeNull();
  });

  it("says when nothing was spent, and what to do", async () => {
    await open({
      usage: () => report({ totals: { ...group("", 0), sessions: 0 } }),
    });
    expect(screen.queryByText("Nothing spent in this period.")).not.toBeNull();
    expect(screen.queryByText("ork run <workflow>")).not.toBeNull();
  });

  it("does not speak of a period under all time", async () => {
    await open({
      usage: () => report({ totals: { ...group("", 0), sessions: 0 } }),
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "All time" }),
    );
    expect(screen.queryByText("Nothing spent yet.")).not.toBeNull();
  });

  it("says when the server refuses, and tries again", async () => {
    const { container, state } = await open({
      refuseUsage: "the store is locked",
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "the store is locked",
    );
    screen.getByText("ork usage --all --since 30d");
    expect(await violations(container)).toEqual([]);
    const load = vi.spyOn(state.usage, "load");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps a good report when reading it again fails", async () => {
    const { state } = await open();
    await act(async () => {
      await state.usage.load({
        now: Date.now(),
        period: "30",
        query: { project: "/refused" },
      });
    });
    expect(screen.getByText("Spend").nextSibling?.textContent).toBe("$12.50");
  });

  it("names the command that lists what does not fit", async () => {
    const many = report();
    many.groups.workflow = Array.from({ length: 12 }, (_, index) =>
      group(`flow-${String(index)}`, 1),
    );
    await open({ usage: () => many });
    const flows = screen.getByRole("region", { name: "By workflow" });
    expect(flows.textContent).toContain("And 2 more that cost less");
    expect(flows.textContent).toContain(
      "ork usage --all --since 30d --by workflow",
    );
  });

  it("keeps its filters when the panel is mounted again", async () => {
    const { state } = await open();
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "All time" }),
    );
    cleanup();
    renderPanel(state, <UsagePanel />);
    expect(
      screen.getByRole("combobox", { name: "Period" }).textContent,
    ).toContain("All time");
  });

  it("lists only the days with spend, newest first, and counts the rest", async () => {
    const table = await open();
    const rows = within(table.container)
      .getAllByRole("rowheader", { hidden: true })
      .map(row => row.textContent);
    expect(rows.filter(row => row.startsWith("2026-"))).toEqual([
      "2026-11-03",
      "2026-11-01",
    ]);
    screen.getByText(/days? with no spend/u);
  });
});

describe("the Usage panel's model", () => {
  const NOW = new Date(2026, 10, 4, 15).getTime();

  it("fills the empty days with zero, up to today", () => {
    const { unit, bars, maxUsd } = seriesOf(
      report(),
      new Date(2026, 9, 31, 15).toISOString(),
      NOW,
    );
    expect(unit).toBe("day");
    expect(bars.map(bar => [bar.key, bar.costUsd])).toEqual([
      ["2026-10-31", 0],
      ["2026-11-01", 2],
      ["2026-11-02", 0],
      ["2026-11-03", 10.5],
      ["2026-11-04", 0],
    ]);
    expect(maxUsd).toBe(10.5);
  });

  it("starts all time at the first spend", () => {
    const { bars } = seriesOf(report(), undefined, NOW);
    expect(bars[0]?.key).toBe("2026-11-01");
    expect(bars.at(-1)?.key).toBe("2026-11-04");
  });

  it("draws weeks once there are too many days", () => {
    const long = report();
    long.groups.day = [group("2026-01-01", 1), group("2026-11-03", 1)];
    long.groups.week = [group("2026-10-19", 1), group("2026-11-02", 1)];
    const { unit, bars } = seriesOf(
      long,
      new Date(2026, 9, 19).toISOString(),
      NOW,
    );
    expect(unit).toBe("day");
    const all = seriesOf(long, undefined, NOW);
    expect(all.unit).toBe("week");
    expect(all.bars[0]?.key).toBe("2025-12-29");
    expect(all.bars.at(-1)?.key).toBe("2026-11-02");
    expect(bars).toHaveLength(17);
  });

  it("has no bars for all time with no spend", () => {
    const empty = report();
    empty.groups.day = [];
    empty.groups.week = [];
    expect(seriesOf(empty, undefined, NOW)).toEqual({
      unit: "day",
      bars: [],
      maxUsd: 0,
    });
  });

  it("starts a period at a midnight, counting today", () => {
    expect(sinceOf("7", NOW)).toBe(new Date(2026, 9, 29).toISOString());
    expect(sinceOf("all", 0)).toBeUndefined();
    const week = seriesOf(report(), sinceOf("7", NOW), NOW);
    expect(week.bars).toHaveLength(7);
  });

  it("reads odd sums sensibly", () => {
    expect(money(0.000_01)).toBe("<$0.0001");
    expect(money(-0.000_01)).toBe("$0.00");
    expect(money(-50)).toBe("-$50.00");
    expect(money(Number.NaN)).toBe("–");
    expect(money(9.999_96)).toBe("$10.00");
  });

  it("puts a table's sums to one precision", () => {
    const cost = moneyOf([0, 0.2957, 12.5]);
    expect([cost(0), cost(0.2957), cost(12.5)]).toEqual([
      "$0.0000",
      "$0.2957",
      "$12.5000",
    ]);
    const large = moneyOf([0, 12.5]);
    expect([large(0), large(12.5)]).toEqual(["$0.00", "$12.50"]);
  });

  it("says what the same report is on a terminal", () => {
    expect(usageCommand(true, "30")).toBe("ork usage --all --since 30d");
    expect(usageCommand(false, "all", "node")).toBe(
      "ork usage --since all --by node",
    );
  });
});
