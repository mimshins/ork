/**
 * @file Tests for a gate's `document`: taken by `human.gate`, refused
 *   elsewhere.
 */

import { describe, expect, it } from "vitest";

import { NodeSchema } from "../src/index.ts";

const gate = {
  type: "human.gate",
  question: "Ship it?",
  options: ["yes", "no"],
};

describe("human.gate document", () => {
  it("is optional and takes a template", () => {
    expect(NodeSchema.safeParse(gate).success).toBe(true);
    const parsed = NodeSchema.safeParse({
      ...gate,
      document: "{{nodes.spec.output.spec}}",
    });
    expect(parsed.success).toBe(true);
  });

  it("must be a string", () => {
    expect(NodeSchema.safeParse({ ...gate, document: 3 }).success).toBe(false);
  });

  it.each([{ type: "tool.shell", command: "true" }, { type: "claude.worker" }])(
    "is an unknown field on $type",
    node => {
      expect(NodeSchema.safeParse({ ...node, document: "x" }).success).toBe(
        false,
      );
    },
  );
});
