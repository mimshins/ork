/** @file Tests for the shared list refusal sentences. */

import { describe, expect, it } from "vitest";

import { limitRefusal, unknownProjectRefusal } from "../src/index.ts";

describe("list refusals", () => {
  it("says why a limit is refused", () => {
    expect(limitRefusal("1e21")).toBe(
      "--limit takes a positive whole number written in digits, not `1e21`.",
    );
  });

  it("lists the registered projects, or none", () => {
    expect(unknownProjectRefusal("nope", ["a", "b"])).toBe(
      "No registered project `nope`; registered: a, b.",
    );
    expect(unknownProjectRefusal("nope", [])).toBe(
      "No registered project `nope`; registered: none.",
    );
  });
});
