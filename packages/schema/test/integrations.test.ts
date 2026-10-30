/**
 * @file Tests that the workflow schema gives every registered integration its
 *   node type, with the integration's own options and nothing else.
 */

import { INTEGRATIONS } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

import { NodeSchema } from "../src/index.ts";

const parses = (node: Record<string, unknown>) =>
  NodeSchema.safeParse(node).success;

describe("tool node types", () => {
  it("exist for every registered integration", () => {
    expect(
      INTEGRATIONS.map(i => parses({ type: `tool.${i.id}`, command: "x" })),
    ).toEqual(INTEGRATIONS.map(() => true));
  });

  it("take an integration's own options, and only its own", () => {
    expect(parses({ type: "tool.aws", command: "x", profile: "dev" })).toBe(
      true,
    );
    expect(parses({ type: "tool.gh", command: "x", profile: "dev" })).toBe(
      false,
    );
    expect(parses({ type: "tool.nope", command: "x" })).toBe(false);
  });
});
