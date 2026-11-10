/** @file Tests the control estimate's pricing, prompts, pushes and quantiles. */

import { describe, expect, it } from "vitest";

import { weightedQuantile } from "../control.ts";
import { isHumanPrompt, priceOf, pushesIn } from "../transcripts.ts";

describe("a message's price", () => {
  it("prices each kind of token, with 5-minute and 1-hour writes apart", () => {
    const usd = priceOf("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 2_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });
    expect(usd).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);
  });

  it("takes an unsplit cache write as 1-hour", () => {
    expect(
      priceOf("claude-sonnet-5-5", { cache_creation_input_tokens: 1_000_000 }),
    ).toBeCloseTo(4);
  });
});

describe("a human prompt", () => {
  it.each([
    [{ type: "user", message: { content: "fix the CI" } }, true],
    [
      { type: "user", message: { content: [{ type: "text", text: "go" }] } },
      true,
    ],
    [{ type: "user", message: { content: [{ type: "tool_result" }] } }, false],
    [{ type: "user", message: { content: "<system-reminder>…" } }, false],
    [{ type: "user", isMeta: true, message: { content: "x" } }, false],
    [{ type: "assistant", message: { content: "x" } }, false],
  ])("%j is %s", (entry, human) => {
    expect(isHumanPrompt(entry)).toBe(human);
  });
});

describe("pushes", () => {
  it("reads every push to main in a text", () => {
    expect(
      pushesIn(
        "To github.com:o/r.git\n   d07aa32..77f0b18  main -> main\n e97d75c..fcf9d40  main -> main",
      ),
    ).toEqual([
      { from: "d07aa32", to: "77f0b18" },
      { from: "e97d75c", to: "fcf9d40" },
    ]);
  });
});

describe("a weighted quantile", () => {
  it("counts each value by its weight", () => {
    const items = [
      { value: 1, weight: 1 },
      { value: 10, weight: 8 },
      { value: 100, weight: 1 },
    ];
    expect([0.05, 0.5, 0.95].map(q => weightedQuantile(items, q))).toEqual([
      1, 10, 100,
    ]);
  });
});
