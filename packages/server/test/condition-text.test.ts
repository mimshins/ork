/**
 * @file Writing the builder's choices as a `when:` (RFC-010): each reads back
 *   as what was chosen, through the reader the view uses.
 */

import { type Condition, readCondition } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { conditionText, oppositeOf } from "../src/condition-text.ts";

const test = (
  ...rows: Extract<Condition, { mode: "test" }>["rows"]
): Condition => ({ mode: "test", join: "all", rows });

describe("conditionText", () => {
  it("writes each mode", () => {
    expect(conditionText({ mode: "succeeds" })).toBeUndefined();
    expect(conditionText({ mode: "fails" })).toBe("!ok");
    expect(conditionText({ mode: "otherwise" })).toBe("true");
    expect(conditionText({ mode: "hand", text: "a == 1" })).toBe("a == 1");
    expect(
      conditionText({
        mode: "test",
        join: "any",
        rows: [
          { field: "status", test: "is", value: "pass" },
          { field: "count", test: "above", value: 1 },
        ],
      }),
    ).toBe("status == 'pass' || count > 1");
  });

  it("reads back as what was chosen", () => {
    const conditions: Condition[] = [
      { mode: "succeeds" },
      { mode: "fails" },
      { mode: "otherwise" },
      test({ field: "status", test: "is", value: "pass" }),
      test({ field: "status", test: "isnt", value: "pass" }),
      test({ field: "exitCode", test: "above", value: 1 }),
      test({ field: "exitCode", test: "atLeast", value: 1 }),
      test({ field: "exitCode", test: "below", value: 1 }),
      test({ field: "exitCode", test: "atMost", value: 1 }),
      test({ field: "statuses", test: "anyIs", value: "fail" }),
      test({ field: "statuses", test: "allAre", value: "pass" }),
      test({ field: "stderr", test: "contains", value: "it's \\ here" }),
      test({ field: "json.on", test: "isTrue" }),
      test({ field: "json.on", test: "isFalse" }),
      test({ field: "json.on", test: "is", value: false }),
      test(
        { field: "a", test: "is", value: 1 },
        { field: "b", test: "isnt", value: "x" },
      ),
      {
        mode: "test",
        join: "any",
        rows: [
          { field: "a", test: "is", value: 1 },
          { field: "b", test: "isnt", value: "x" },
        ],
      },
    ];
    for (const condition of conditions) {
      expect(readCondition(conditionText(condition))).toEqual(condition);
    }
  });
});

describe("oppositeOf", () => {
  it("flips one test", () => {
    expect(
      oppositeOf(test({ field: "status", test: "is", value: "pass" })),
    ).toBe("status != 'pass'");
    expect(oppositeOf(test({ field: "n", test: "above", value: 1 }))).toBe(
      "n <= 1",
    );
    expect(oppositeOf(test({ field: "on", test: "isTrue" }))).toBe("!on");
    expect(oppositeOf({ mode: "fails" })).toBe("ok");
  });

  it("wraps what it can't flip", () => {
    expect(
      oppositeOf(test({ field: "statuses", test: "anyIs", value: "fail" })),
    ).toBe("!(any(statuses, 'fail'))");
    expect(oppositeOf({ mode: "hand", text: "a || b" })).toBe("!(a || b)");
  });

  it("has nothing for a loop that's always taken", () => {
    expect(oppositeOf({ mode: "succeeds" })).toBeUndefined();
    expect(oppositeOf({ mode: "otherwise" })).toBeUndefined();
  });
});
