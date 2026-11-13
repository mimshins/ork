/**
 * @file Tests for the branch a report names: kept when git would take it as a
 *   branch, dropped when a command could read it as an option or a refspec.
 */

import { describe, expect, it } from "vitest";

import { parseReport } from "../src/index.ts";

const branchOf = (branch: string): string | undefined =>
  parseReport({ status: "pass", summary: "done", branch })?.branch;

describe("a report's branch", () => {
  it("keeps a plain branch name", () => {
    expect(branchOf("ork/run-1a2b/build")).toBe("ork/run-1a2b/build");
    expect(branchOf("feature/x.y")).toBe("feature/x.y");
  });

  it("drops one a command could read as an option or a refspec", () => {
    expect(branchOf("+HEAD:main")).toBeUndefined();
    expect(branchOf("--force")).toBeUndefined();
    expect(branchOf("main:other")).toBeUndefined();
  });

  it("drops one git would refuse", () => {
    expect(branchOf("a b")).toBeUndefined();
    expect(branchOf("a..b")).toBeUndefined();
    expect(branchOf("x.lock")).toBeUndefined();
    expect(branchOf("ref@{1}")).toBeUndefined();
    expect(branchOf("a~1")).toBeUndefined();
    expect(branchOf("")).toBeUndefined();
  });
});
