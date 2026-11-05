/**
 * @file Tests for how a message marks a value: it stays one value, whatever it
 *   holds.
 */

import { describe, expect, it } from "vitest";

import { markValue } from "../src/index.ts";

describe("markValue", () => {
  it.each([
    ["a plain value", "x", "`x`"],
    ["a backtick inside", "a`b", "``a`b``"],
    ["two in a row", "a``b", "```a``b```"],
    ["one at the edge, which needs room", "`a", "`` `a ``"],
    ["only a backtick", "`", "`` ` ``"],
    ["a line break", "x == 1\n", "`x == 1`"],
    ["nothing", " ", "(nothing)"],
  ])("marks %s", (_, value, marked) => {
    expect(markValue(value)).toBe(marked);
  });
});
