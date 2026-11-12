/**
 * @file Tests for `budgetTokens` and `quotas.dayTokens`: where they go and what
 *   they accept.
 */

import { describe, expect, it } from "vitest";

import {
  AgentSettingsSchema,
  DefaultsSchema,
  NodeSchema,
  ProjectSchema,
  QuotasSchema,
  UserSettingsSchema,
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

/** The messages a parse refused with, one per issue. */
const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] => (result.error?.issues ?? []).map(issue => issue.message);

const workflow = (budget: unknown) => ({
  schemaVersion: 1,
  name: "t",
  limits: { budgetTokens: budget },
  nodes: { a: { type: "tool.shell", command: "true" } },
});

describe("a refused budget", () => {
  const WHOLE = "must be a whole number above 0";
  const place: Record<string, (budget: unknown) => string[]> = {
    node: budget =>
      messages(
        NodeSchema.safeParse({ type: "agent.worker", budgetTokens: budget }),
      ),
    agent: budget =>
      messages(AgentSettingsSchema.safeParse({ budgetTokens: budget })),
    workflow: budget => messages(WorkflowSchema.safeParse(workflow(budget))),
    project: budget =>
      messages(
        ProjectSchema.safeParse({
          schemaVersion: 1,
          defaults: { budgetTokens: budget },
        }),
      ),
    settings: budget =>
      messages(
        UserSettingsSchema.safeParse({
          schemaVersion: 1,
          quotas: { dayTokens: budget },
        }),
      ),
  };

  it.each(Object.keys(place))("says what a token cap takes, in %s", where => {
    for (const budget of [-5, 0, 1.5, "10"]) {
      expect(place[where]?.(budget)).toEqual([WHOLE]);
    }
  });

  it("says what a dollar cap takes", () => {
    expect(messages(DefaultsSchema.safeParse({ budgetUsd: -1 }))).toEqual([
      "must be a number above 0",
    ]);
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
