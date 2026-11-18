/**
 * @file Tests the A/B join of benchmarks: a name gives its task and arm, roles
 *   fall into implement, review or other, a row sums the reading kinds by group
 *   and counts each kind's calls and refusals, and the table gives each task
 *   and arm's medians.
 */

import { describe, expect, it } from "vitest";

import { armsMarkdown, groupOf, rowOf, taskArm } from "../arms.ts";

const summary = {
  run: "abcd1234",
  status: "succeeded",
  cost_usd: 0.8492,
  minutes: { working: 12.34 },
  sessions: 6,
};

const carried = {
  turns: { median: 3 },
  calls_by_role: {
    "build.build": {
      extract: { calls: 5, refused: 0, weight: 1000 },
      Read: { calls: 2, refused: 0, weight: 300 },
      searches: { calls: 1, refused: 1, weight: 50 },
      "tests and checks": { calls: 2, refused: 0, weight: 999 },
    },
    "build.review": {
      "git diff/show/log": { calls: 1, refused: 0, weight: 400 },
    },
    "build.docs": { extract: { calls: 1, refused: 0, weight: 20 } },
  },
};

describe("benchmark arms", () => {
  it("reads the task and arm from the name", () => {
    expect(taskArm("rfc023-t1-open-2")).toEqual({ task: "t1", arm: "open" });
  });

  it("groups roles into implement, review and other", () => {
    expect(
      ["build.build", "build.review", "build.polish-review", "build.docs"].map(
        role => groupOf(role),
      ),
    ).toEqual(["implement", "review", "review", "other"]);
  });

  it("sums the reading kinds by group and counts calls and refusals", () => {
    const row = rowOf("rfc023-t1-extract-1", summary, carried);
    expect(row).toMatchObject({
      task: "t1",
      arm: "extract",
      run: "abcd1234",
      cost: 0.85,
      working: 12.3,
      turns: 3,
      reading: { implement: 1350, review: 400, all: 1770 },
      calls: { extract: 6, around: 2, read: 2, refused: 1 },
    });
  });

  it("gives each task and arm's medians", () => {
    const a = rowOf("x-t1-open-1", summary, carried);
    const b = rowOf("x-t1-open-2", { ...summary, cost_usd: 1.25 }, carried);
    const md = armsMarkdown([a, b]);
    expect(md).toContain("| t1 | open | 2 | $1.05 |");
  });
});
