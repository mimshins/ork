/**
 * @file Tests for the shared secret patterns (ADR-091): a `g` or `y` flag would
 *   make the audit scan's `.test()` stateful, and the masker adds `g` itself.
 */

import { describe, expect, it } from "vitest";

import { SECRET_PATTERNS } from "../src/index.ts";

/** The names of the patterns that carry a stateful flag. */
const statefulPatterns = (): string[] =>
  SECRET_PATTERNS.filter(({ pattern }) => /[gy]/u.test(pattern.flags)).map(
    ({ name }) => name,
  );

describe("the shared secret patterns", () => {
  it("carry no g or y flag", () => {
    expect(statefulPatterns()).toEqual([]);
  });
});
