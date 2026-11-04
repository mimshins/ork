/**
 * @file Tests for how a status glyph is drawn: its filled cells become whole
 *   squares, so it stays crisp at a size that lands on whole pixels.
 */

import { describe, expect, it } from "vitest";

import { glyphPath } from "../../src/components/status-glyphs.tsx";

describe("a status glyph", () => {
  it("draws a square for each filled cell, where the cell is", () => {
    expect(glyphPath(["#.", ".#"])).toBe("M0 0h1v1h-1zM1 1h1v1h-1z");
  });

  it("draws nothing for an empty row", () => {
    expect(glyphPath(["..."])).toBe("");
  });
});
