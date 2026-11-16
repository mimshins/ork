/**
 * @file Tests for the cost preview's caps: both built-ins set dollar and token
 *   limits, the total is their sum, and the line says each part.
 */

import { builtinWorkflowText } from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  capsOfOnboard,
  previewLine,
  PROPOSE,
  WRITE,
} from "../src/onboard/caps.ts";

const limitsOf = (name: string) => {
  const parsed = parseWorkflow(builtinWorkflowText(name) ?? "");
  return parsed.ok ? parsed.workflow.limits : undefined;
};

describe("capsOfOnboard", () => {
  it("sums both built-ins' limits", () => {
    const caps = capsOfOnboard();
    const propose = limitsOf(PROPOSE);
    const write = limitsOf(WRITE);
    expect(caps.propose.usd).toBe(propose?.budgetUsd);
    expect(caps.write.tokens).toBe(write?.budgetTokens);
    expect(caps.usd).toBe(caps.propose.usd + caps.write.usd);
    expect(caps.tokens).toBe(caps.propose.tokens + caps.write.tokens);
    expect(caps.usd).toBeGreaterThan(0);
    expect(caps.tokens).toBeGreaterThan(0);
  });

  it("words the preview with the total and each part", () => {
    const caps = {
      propose: { usd: 3, tokens: 600000 },
      write: { usd: 6, tokens: 1200000 },
      usd: 9,
      tokens: 1800000,
    };
    expect(previewLine(caps)).toBe(
      "The most this can spend: $9 or 1,800,000 tokens (propose $3, 600,000 tokens; write $6, 1,200,000 tokens).",
    );
  });
});

/** The places a built-in names a `model` or `driver`, as `where: key`. */
const namedModelsOf = (name: string): string[] => {
  const parsed = parseWorkflow(builtinWorkflowText(name) ?? "");
  if (!parsed.ok) return ["does not parse"];
  const { defaults, nodes } = parsed.workflow;
  const places: { where: string; holder: object | undefined }[] = [
    { where: "defaults", holder: defaults },
    ...Object.entries(nodes).map(([id, node]) => ({
      where: `node ${id}`,
      holder: node,
    })),
  ];
  return places.flatMap(({ where, holder }) =>
    ["model", "driver"]
      .filter(key => holder !== undefined && key in holder)
      .map(key => `${where}: ${key}`),
  );
};

describe("the built-ins name no model or driver", () => {
  it.each([PROPOSE, WRITE])("%s", name => {
    expect(namedModelsOf(name)).toEqual([]);
  });
});
