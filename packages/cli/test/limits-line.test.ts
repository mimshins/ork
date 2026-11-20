/**
 * @file Tests for how the Limits line of `ork usage` prints a dollar cap: both
 *   sides with the same digits.
 */

import { describe, expect, it } from "vitest";

import { formatLimits } from "../src/runs/usage.ts";
import type { Term } from "../src/term/mode.ts";

const plainTerm: Term = { rich: false, width: 80, rows: 24 };

const capLine = (spentUsd: number, capUsd: number): string | undefined =>
  formatLimits(
    {
      problems: [],
      caps: [
        {
          window: "day",
          capUsd,
          spentUsd,
          leftUsd: capUsd - spentUsd,
          resetsAt: "2026-11-04T00:00:00.000Z",
        },
      ],
      plan: [],
    },
    plainTerm,
  )[1];

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number): string =>
  new Date(NOW - hoursAgo * HOUR).toISOString();

const planLine = (
  limit: Parameters<typeof formatLimits>[0]["plan"][number],
): string =>
  formatLimits({ problems: [], caps: [], plan: [limit] }, plainTerm)[1] ?? "";

describe("the Limits line's plan limit", () => {
  const resetsAt = "2030-01-01T00:00:00.000Z";

  it("says a fresh warning is close and when it was seen", () => {
    const line = planLine({
      status: "allowed_warning",
      window: "seven_day",
      resetsAt,
      at: at(2),
    });
    expect(line).toContain("Claude plan's seven day limit is close, resets ");
    expect(line).toContain("(seen 2h ago)");
    expect(line).not.toContain("stale");
  });

  it("says a stale warning was close, and that it is stale", () => {
    const line = planLine({
      status: "allowed_warning",
      window: "seven_day",
      resetsAt,
      at: at(30),
      stale: true,
    });
    expect(line).toContain("seven day limit was close, resets ");
    expect(line).toContain("(seen 1d ago, stale)");
    expect(line).not.toContain("is close");
  });

  it("dates a rejected limit, and drops resets without a time", () => {
    const line = planLine({
      status: "rejected",
      window: "five_hour",
      at: at(2),
    });
    expect(line).toContain(
      "Claude plan's five hour limit was reached (seen 2h ago)",
    );
    expect(line).not.toContain("resets");
  });
});

describe("the Limits line's dollar cap", () => {
  it("prints nothing spent with the digits of a cap under a dollar", () => {
    expect(capLine(0, 0.01)).toContain("$0.0000 of $0.0100");
  });

  it("prints a spend under a dollar and a larger cap with four digits each", () => {
    expect(capLine(0.5, 5)).toContain("$0.5000 of $5.0000");
  });

  it("keeps cents when both are dollars or nothing is spent", () => {
    expect(capLine(1, 5)).toContain("$1.00 of $5.00");
    expect(capLine(0, 5)).toContain("$0.00 of $5.00");
  });
});
