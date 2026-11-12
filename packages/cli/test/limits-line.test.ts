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
