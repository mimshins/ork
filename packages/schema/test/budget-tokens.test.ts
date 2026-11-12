/**
 * @file Tests for `budgetTokens` and `quotas.dayTokens`: where they go and what
 *   they accept.
 */

import { describe, expect, it } from "vitest";

import {
  AgentSettingsSchema,
  DefaultsSchema,
  NodeSchema,
  QuotasSchema,
  WorkflowSchema,
} from "../src/index.ts";

describe("budgetTokens", () => {
  it("is taken by nodes, agent settings, defaults and limits", () => {
    expect(
      NodeSchema.safeParse({ type: "agent.worker", budgetTokens: 50_000 })
        .success,
    ).toBe(true);
    expect(
      AgentSettingsSchema.safeParse({ budgetTokens: 50_000 }).success,
    ).toBe(true);
    expect(DefaultsSchema.safeParse({ budgetTokens: 50_000 }).success).toBe(
      true,
    );
    const parsed = WorkflowSchema.safeParse({
      schemaVersion: 1,
      name: "t",
      limits: { budgetTokens: 1_000_000 },
      nodes: { a: { type: "tool.shell", command: "true" } },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([0, -1, 1.5, "10"])("refuses %j", value => {
    expect(DefaultsSchema.safeParse({ budgetTokens: value }).success).toBe(
      false,
    );
  });
});

describe("quotas.dayTokens", () => {
  it("sits beside dayUsd", () => {
    expect(
      QuotasSchema.safeParse({ dayUsd: 5, dayTokens: 2_000_000 }).success,
    ).toBe(true);
  });

  it.each([0, 0.5, -3])("refuses %j", value => {
    expect(QuotasSchema.safeParse({ dayTokens: value }).success).toBe(false);
  });
});
