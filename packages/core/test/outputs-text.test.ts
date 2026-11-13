/**
 * @file The outputs formatter: scrubbed, cut by lines and by characters,
 *   nothing for none.
 */

import { describe, expect, it } from "vitest";

import {
  OUTPUT_MAX_CHARS,
  OUTPUT_MAX_LINES,
  outputsText,
} from "../src/index.ts";

describe("outputsText", () => {
  it("is empty with no outputs", () => {
    expect(outputsText()).toEqual([]);
    expect(outputsText({})).toEqual([]);
  });

  it("keeps one entry per key, in order, a short value whole", () => {
    expect(outputsText({ url: "https://x/pr/1", a: "x\ny\n" })).toEqual([
      { name: "url", text: "https://x/pr/1", cut: false },
      { name: "a", text: "x\ny", cut: false },
    ]);
  });

  it("strips escape sequences and blanks other control characters", () => {
    const [out] = outputsText({ k: "\u001B[31mred\u001B[0m\u0001 ok\r\nnext" });
    expect(out?.text).toBe("red  ok\nnext");
  });

  it("cuts a long value by lines", () => {
    const value = Array.from({ length: 30 }, (_, i) => `l${String(i)}`);
    const [out] = outputsText({ k: value.join("\n") });
    expect(out?.text.split("\n")).toHaveLength(OUTPUT_MAX_LINES);
    expect(out?.cut).toBe(true);
  });

  it("cuts a long value by characters", () => {
    const [out] = outputsText({ k: "a".repeat(OUTPUT_MAX_CHARS + 5) });
    expect(out?.text).toHaveLength(OUTPUT_MAX_CHARS);
    expect(out?.cut).toBe(true);
  });
});
