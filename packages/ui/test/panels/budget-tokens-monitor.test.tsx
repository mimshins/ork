/**
 * @file Tests for budgets in tokens on the Monitor (RFC-015): the Spent stat
 *   reads a partial dollar sum as a floor with the tokens beside it and draws a
 *   meter for each cap, and a node's facts count cache writes and mark a node
 *   whose driver has no price.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import { factsOf } from "../../src/panels/monitor-model.ts";
import { RunStats } from "../../src/panels/run-stats.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { treeNode } from "./monitor-fixtures.ts";

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stats = (
  over: Partial<ReturnType<typeof runView>>,
  budgets: { budgetUsd?: number; budgetTokens?: number } = {},
) =>
  render(
    <TipProvider>
      <RunStats
        budgetTokens={budgets.budgetTokens}
        budgetUsd={budgets.budgetUsd}
        facts={new Map()}
        now={0}
        run={{ ...runView("r1"), ...over }}
      />
    </TipProvider>,
  );

const spentTerm = (): HTMLElement =>
  screen.getByText(/^Spent/u, { selector: "dt" });

describe("the Monitor's Spent stat", () => {
  it("shows a partial sum as a floor, with the tokens beside it", () => {
    stats({ costUsd: 1.2, partial: true, tokens: 48_200 });
    const dd = spentTerm().nextElementSibling;
    expect(dd?.textContent).toContain("at least $1.2000, partial");
    screen.getByText("≥ $1.2000");
    screen.getByText("48.2k tokens");
  });

  it("names a token cap and shows no dollar meter for it alone", () => {
    const { container } = stats(
      { costUsd: 0, partial: true, tokens: 48_200 },
      { budgetTokens: 50_000 },
    );
    expect(spentTerm().textContent).toBe("Spent · cap 50k tokens");
    expect(container.querySelectorAll("[data-level]")).toHaveLength(1);
  });

  it("draws the dollar meter and the token meter when both are set", () => {
    const { container } = stats(
      { costUsd: 1, tokens: 100 },
      { budgetUsd: 5, budgetTokens: 2_000_000 },
    );
    expect(spentTerm().textContent).toBe("Spent · cap $5.00 · cap 2M tokens");
    expect(container.querySelectorAll("[data-level]")).toHaveLength(2);
  });

  it("shows no tokens line for a run with none", () => {
    stats({ costUsd: 1 });
    expect(screen.queryByText(/tokens$/u)).toBeNull();
    expect(screen.queryByText(/≥/u)).toBeNull();
  });

  it("explains a partial sum on keyboard focus", async () => {
    stats({ costUsd: 0, partial: true });
    expect(screen.getByText("≥ $0.00")).not.toBeNull();
    await userEvent.tab();
    await screen.findByText(
      /Some sessions ran on a driver that reports no price/u,
    );
  });
});

describe("a node's facts", () => {
  it("count cache writes and mark a node whose driver has no price", () => {
    const facts = factsOf(
      [
        treeNode("scan", {
          inputTokens: 100,
          outputTokens: 50,
          cacheWriteTokens: 25,
          unpriced: true,
        }),
        treeNode("ship", { costUsd: 1 }),
      ],
      new Set(),
      "r1",
    );
    expect(facts.get("scan")).toMatchObject({ tokens: 175, unpriced: true });
    expect(facts.get("ship")).toMatchObject({ tokens: undefined });
    expect(facts.get("ship")?.unpriced).toBeUndefined();
  });
});
