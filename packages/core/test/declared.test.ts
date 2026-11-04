/** @file Holding a node to what it declares of its output (RFC-010). */

import { describe, expect, it } from "vitest";

import { declaredProblem } from "../src/run/declared.ts";

describe("declaredProblem", () => {
  it("has nothing to say with nothing declared", () => {
    expect(declaredProblem(undefined, "anything")).toBeNull();
    expect(declaredProblem({}, "anything")).toBeNull();
  });

  it("accepts what fits", () => {
    expect(
      declaredProblem(
        { state: ["OPEN", "CLOSED"], n: "integer", on: "boolean", s: "string" },
        { state: "OPEN", n: 2, on: false, s: "x", more: 1 },
      ),
    ).toBeNull();
  });

  it("names the field, the value and what was expected", () => {
    expect(
      declaredProblem(
        { state: ["OPEN", "CLOSED", "MERGED"] },
        { state: "DRAFT" },
      ),
    ).toBe('state is "DRAFT", expected OPEN, CLOSED or MERGED');
    expect(declaredProblem({ n: "integer" }, { n: 1.5 })).toBe(
      "n is 1.5, expected a whole number",
    );
    expect(declaredProblem({ n: "number" }, { n: "1" })).toBe(
      'n is "1", expected a number',
    );
  });

  it("reports a missing field, and every problem", () => {
    expect(declaredProblem({ a: ["x"], b: "string" }, {})).toBe(
      "a is missing, expected x; b is missing, expected text",
    );
  });

  it("refuses a result that has no fields", () => {
    expect(declaredProblem({ a: "string" }, [1])).toBe(
      "the result isn't a JSON object",
    );
    expect(declaredProblem({ a: "string" }, null)).toBe(
      "the result isn't a JSON object",
    );
  });

  it("leaves a field written out as JSON Schema to the driver", () => {
    expect(declaredProblem({ a: { type: "string" } }, {})).toBeNull();
  });

  it("clips a long value", () => {
    expect(declaredProblem({ a: ["x"] }, { a: "y".repeat(200) })).toContain(
      "…",
    );
  });
});
