/** @file Tests for the `timeout` settings: where they go and what they accept. */

import { describe, expect, it } from "vitest";

import { NodeSchema, timeoutMs, WorkflowSchema } from "../src/index.ts";

const shell = (timeout: string) => ({
  type: "tool.shell",
  command: "true",
  timeout,
});

describe("timeout", () => {
  it("is taken by tool nodes and Claude nodes", () => {
    expect(NodeSchema.safeParse(shell("5m")).success).toBe(true);
    expect(
      NodeSchema.safeParse({ type: "claude.worker", timeout: "2h" }).success,
    ).toBe(true);
  });

  it("is taken by the workflow's defaults and limits", () => {
    const parsed = WorkflowSchema.safeParse({
      schemaVersion: 1,
      name: "t",
      defaults: { timeout: "30m" },
      limits: { timeout: "2h" },
      nodes: { a: shell("5m") },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["0s", "00m", "5", "5d", "soon", ""])("refuses %j", value => {
    expect(NodeSchema.safeParse(shell(value)).success).toBe(false);
  });

  it("reads as milliseconds", () => {
    expect(timeoutMs("30s")).toBe(30_000);
    expect(timeoutMs("15m")).toBe(900_000);
    expect(timeoutMs("2h")).toBe(7_200_000);
  });
});
