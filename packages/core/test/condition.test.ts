/** @file Reading a `when:` as the builder's choices (RFC-010). */

import { describe, expect, it } from "vitest";

import { readCondition } from "../src/expr/condition.ts";

describe("readCondition", () => {
  it("reads the plain modes", () => {
    expect(readCondition()).toEqual({ mode: "succeeds" });
    expect(readCondition("!ok")).toEqual({ mode: "fails" });
    expect(readCondition("true")).toEqual({ mode: "otherwise" });
  });

  it.each([
    ["status == 'pass'", { field: "status", test: "is", value: "pass" }],
    [
      "output.status != 'pass'",
      { field: "status", test: "isnt", value: "pass" },
    ],
    ["exitCode >= 2", { field: "exitCode", test: "atLeast", value: 2 }],
    [
      "any(statuses, 'pass')",
      { field: "statuses", test: "anyIs", value: "pass" },
    ],
    [
      "all(statuses, 'pass')",
      { field: "statuses", test: "allAre", value: "pass" },
    ],
    [
      "contains(stderr, 'timeout')",
      { field: "stderr", test: "contains", value: "timeout" },
    ],
    ["json.ready", { field: "json.ready", test: "isTrue" }],
    ["!json.ready", { field: "json.ready", test: "isFalse" }],
  ])("reads %s", (when, row) => {
    expect(readCondition(when)).toEqual({
      mode: "test",
      join: "all",
      rows: [row],
    });
  });

  it("reads several tests under one operator", () => {
    expect(readCondition("status == 'pass' && count > 1")).toEqual({
      mode: "test",
      join: "all",
      rows: [
        { field: "status", test: "is", value: "pass" },
        { field: "count", test: "above", value: 1 },
      ],
    });
    expect(readCondition("a == 1 || b == 2 || c == 3")).toMatchObject({
      mode: "test",
      join: "any",
    });
  });

  it("leaves what the rows can't show as it was written", () => {
    const whens = [
      "a == 1 && b == 2 || c == 3",
      "nodes.x.output.status == 'pass'",
      "inputs.force",
      "run.id == 'x'",
      "'pass' == status",
      "len(stdout) > 2",
      "any(statuses)",
      "status == null",
      "not valid ==",
      "list[0] == 1",
      "false",
    ];
    expect(whens.map(when => readCondition(when))).toEqual(
      whens.map(text => ({ mode: "hand", text })),
    );
  });
});
