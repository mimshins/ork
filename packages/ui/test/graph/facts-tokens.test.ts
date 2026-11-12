/**
 * @file Tests for how tokens and partial dollars read (RFC-015): one token
 *   formatter, the caps without a trailing zero, the floor sign, and a node
 *   with no price saying so in its accessible name.
 */

import { describe, expect, it } from "vitest";

import {
  atLeast,
  formatTokenCap,
  formatTokens,
  nodeName,
} from "../../src/graph/facts.ts";

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [999, "999"],
    [1000, "1.0k"],
    [12_345, "12.3k"],
    [999_949, "999.9k"],
    [999_950, "1.0M"],
    [4_500_000, "4.5M"],
  ])("reads %i as %s", (count, text) => {
    expect(formatTokens(count)).toBe(text);
  });
});

describe("formatTokenCap", () => {
  it.each([
    [950, "950"],
    [50_000, "50k"],
    [12_500, "12.5k"],
    [2_000_000, "2M"],
  ])("reads %i as %s", (cap, text) => {
    expect(formatTokenCap(cap)).toBe(text);
  });
});

describe("atLeast", () => {
  it("puts the floor sign on a partial sum only", () => {
    expect(atLeast("$1.20", true)).toBe("≥ $1.20");
    expect(atLeast("$1.20", false)).toBe("$1.20");
  });
});

describe("a node's name", () => {
  it("says it has no price, after its model", () => {
    expect(
      nodeName("scan", "agent.worker", {
        status: "succeeded",
        model: "command-code.default",
        tokens: 12_300,
        unpriced: true,
      }),
    ).toBe(
      "scan, succeeded, 12.3k tokens, command-code.default, no price, worker",
    );
  });

  it("says nothing of price for a priced node", () => {
    expect(
      nodeName("scan", "agent.worker", { status: "succeeded", costUsd: 1 }),
    ).not.toContain("no price");
  });
});
