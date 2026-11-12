/**
 * @file Tests for budgets in tokens on the Usage panel (RFC-015): totals,
 *   tables and the chart mark a partial dollar sum and show tokens, and a token
 *   cap draws its own meter beside the dollar one.
 */

import type { LimitsReport, UsageReport } from "@krapht/ork-server/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import { UsageChart } from "../../src/panels/usage-chart.tsx";
import { UsageLimits } from "../../src/panels/usage-limits.tsx";
import { seriesOf } from "../../src/panels/usage-model.ts";
import { Breakdown, Totals } from "../../src/panels/usage-tables.tsx";
import { violations } from "../axe.ts";

type Group = UsageReport["groups"]["day"][number];

const group = (key: string, over: Partial<Group> = {}): Group => ({
  key,
  costUsd: 1.2,
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
  ...over,
});

const reportOf = (totals: Group): UsageReport => ({
  totals,
  groups: {
    day: [],
    week: [],
    month: [],
    workflow: [],
    node: [],
    model: [],
    driver: [],
    project: [],
  },
  hints: [],
});

afterEach(cleanup);

const spend = (): string | null | undefined =>
  screen.getByText("Spend", { selector: "dt" }).nextElementSibling?.textContent;

const table = (groups: Group[]) =>
  render(
    <TipProvider>
      <Breakdown
        groups={groups}
        label="Model"
        moreCommand="ork usage --by model"
        title="By model"
        total={2}
      />
    </TipProvider>,
  );

describe("the Usage totals", () => {
  it("marks a partial spend and counts the tokens", () => {
    render(
      <TipProvider>
        <Totals
          report={reportOf(group("", { partial: true, tokens: 48_200 }))}
        />
      </TipProvider>,
    );
    expect(spend()).toContain("at least $1.2000, partial");
    expect(
      screen.getByText("Tokens counted", { selector: "span" }).closest("div")
        ?.textContent,
    ).toContain("48.2k");
  });

  it("hides the tokens counted when there are none", () => {
    render(
      <TipProvider>
        <Totals report={reportOf(group(""))} />
      </TipProvider>,
    );
    expect(screen.queryByText("Tokens counted")).toBeNull();
    expect(spend()).toBe("$1.2000");
  });
});

describe("a Usage table", () => {
  it("marks a partial row and adds Tokens when a row has them", () => {
    table([
      group("command-code.default", { partial: true, tokens: 9_000 }),
      group("claude-sonnet-5-5", { tokens: 1_500 }),
    ]);
    screen.getByRole("columnheader", { name: "Tokens" });
    const rows = screen.getAllByRole("row");
    expect(rows[1]?.textContent).toContain("at least $");
    expect(rows[1]?.textContent).toContain("9.0k");
    expect(rows[2]?.textContent).not.toContain("at least");
  });

  it("has no Tokens column when no row has tokens", () => {
    table([group("claude-sonnet-5-5")]);
    expect(screen.queryByRole("columnheader", { name: "Tokens" })).toBeNull();
  });
});

describe("the Usage chart", () => {
  const NOW = new Date(2026, 10, 4, 15).getTime();
  const chart = (days: Group[]) =>
    render(
      <TipProvider>
        <UsageChart
          series={seriesOf(
            {
              ...reportOf(group("")),
              groups: { ...reportOf(group("")).groups, day: days },
            },
            new Date(2026, 10, 2).toISOString(),
            NOW,
          )}
        />
      </TipProvider>,
    );

  it("says some days are partial and draws a bar for a day of unpriced sessions", () => {
    const { container } = chart([
      group("2026-11-03", { costUsd: 0, partial: true, tokens: 5_000 }),
      group("2026-11-04", { costUsd: 2 }),
    ]);
    screen.getByRole("img", { name: /, some days partial\.$/u });
    expect(container.querySelectorAll("[class*=bar]")).toHaveLength(2);
    screen.getByRole("columnheader", { name: "Tokens" });
  });

  it("stays plain without a partial day", () => {
    chart([group("2026-11-04", { costUsd: 2 })]);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain(
      "partial",
    );
    expect(screen.queryByRole("columnheader", { name: "Tokens" })).toBeNull();
  });
});

const limits = (over: Partial<LimitsReport>): LimitsReport => ({
  problems: [],
  caps: [],
  plan: [],
  ...over,
});

const TOKEN_DAY = {
  window: "day" as const,
  capTokens: 50_000,
  spentTokens: 12_300,
  leftTokens: 37_700,
  resetsAt: "2030-01-01T00:00:00.000Z",
};

describe("the limits", () => {
  it("draws a token meter with the day's tokens, and says what counts", () => {
    render(<UsageLimits limits={limits({ tokenCaps: [TOKEN_DAY] })} />);
    const meter = screen.getByRole("meter", {
      name: "All projects, this day, in tokens",
    });
    expect(meter.getAttribute("aria-valuetext")).toMatch(
      /^12\.3k of 50k tokens, resets /u,
    );
    expect(meter.getAttribute("aria-valuetext")).not.toContain("reached");
    screen.getByText(
      "Tokens counted: input, output and cache write. Cache reads are not counted.",
    );
  });

  it("says when the cap is reached", () => {
    render(
      <UsageLimits
        limits={limits({
          tokenCaps: [{ ...TOKEN_DAY, spentTokens: 50_000, leftTokens: 0 }],
        })}
      />,
    );
    expect(
      screen
        .getByRole("meter", { name: "All projects, this day, in tokens" })
        .getAttribute("aria-valuetext"),
    ).toMatch(/, reached$/u);
  });

  it("puts the dollar meter before the token meter of the same window", () => {
    render(
      <UsageLimits
        limits={limits({
          caps: [
            {
              window: "day",
              capUsd: 20,
              spentUsd: 5,
              leftUsd: 15,
              resetsAt: TOKEN_DAY.resetsAt,
            },
          ],
          tokenCaps: [TOKEN_DAY],
        })}
      />,
    );
    expect(
      screen
        .getAllByRole("meter")
        .map(meter => meter.textContent?.slice(0, 40)),
    ).toEqual([
      expect.stringContaining("All projects, this day$5.00"),
      expect.stringContaining("All projects, this day, in tokens12.3k"),
    ]);
  });

  it("draws no token meter, or note, without a token cap", () => {
    render(
      <UsageLimits
        limits={limits({
          plan: [
            {
              status: "rejected",
              window: "five_hour",
              at: "2029-12-31T20:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText(/Tokens counted/u)).toBeNull();
  });
});

describe("accessibility of the token states", () => {
  it("has no violations in the totals, with a partial sum and tokens counted", async () => {
    const { container } = render(
      <TipProvider>
        <Totals
          report={reportOf(group("", { partial: true, tokens: 48_200 }))}
        />
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations in a table with a Tokens column", async () => {
    const { container } = table([
      group("command-code.default", { partial: true, tokens: 9_000 }),
      group("claude-sonnet-5-5", { tokens: 1_500 }),
    ]);
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations in the chart with a partial bar", async () => {
    const { container } = render(
      <TipProvider>
        <UsageChart
          series={seriesOf(
            {
              ...reportOf(group("")),
              groups: {
                ...reportOf(group("")).groups,
                day: [
                  group("2026-11-03", {
                    costUsd: 0,
                    partial: true,
                    tokens: 5_000,
                  }),
                  group("2026-11-04", { costUsd: 2 }),
                ],
              },
            },
            new Date(2026, 10, 2).toISOString(),
            new Date(2026, 10, 4, 15).getTime(),
          )}
        />
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations in the limits with a token meter, its note, and a reached one", async () => {
    const { container } = render(
      <UsageLimits
        limits={limits({
          tokenCaps: [
            TOKEN_DAY,
            { ...TOKEN_DAY, project: "/p", spentTokens: 50_000, leftTokens: 0 },
          ],
        })}
      />,
    );
    expect(await violations(container)).toEqual([]);
  });
});
