/**
 * @file The output limits the browser bundle holds equal core's, which
 *   `outputsText` cuts at.
 */

import { OUTPUT_MAX_CHARS, OUTPUT_MAX_LINES } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import * as limits from "../src/contract-outputs.ts";

describe("the contract's output limits", () => {
  it("equal core's", () => {
    expect([limits.OUTPUT_MAX_LINES, limits.OUTPUT_MAX_CHARS]).toEqual([
      OUTPUT_MAX_LINES,
      OUTPUT_MAX_CHARS,
    ]);
  });
});
