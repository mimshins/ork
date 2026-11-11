/** @file Tests for `once:` on `verify:` and on tool nodes. */

import { describe, expect, it } from "vitest";

import { NodeSchema } from "../src/index.ts";

const worker = (once: unknown) => ({
  type: "agent.worker",
  verify: { command: "pnpm check", once },
});
const shell = (once: unknown) => ({
  type: "tool.shell",
  command: "true",
  once,
});

describe("once", () => {
  it("is taken by verify: and by tool nodes, and optional", () => {
    expect(NodeSchema.safeParse(worker(true)).success).toBe(true);
    expect(NodeSchema.safeParse(shell(true)).success).toBe(true);
  });

  it("leaves it out", () => {
    expect(
      NodeSchema.safeParse({ type: "tool.shell", command: "true" }).success,
    ).toBe(true);
  });

  it.each(["yes", 1, null])("refuses %j", value => {
    expect(NodeSchema.safeParse(worker(value)).success).toBe(false);
    expect(NodeSchema.safeParse(shell(value)).success).toBe(false);
  });

  it("is not taken by before:", () => {
    const node = {
      type: "agent.worker",
      before: { command: "x", once: true },
    };
    expect(NodeSchema.safeParse(node).success).toBe(false);
  });
});
