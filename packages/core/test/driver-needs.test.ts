/**
 * @file Tests for what a node needs of its driver (RFC-014): `maxTurns`,
 *   `budgetUsd`, delegation and owner questions against a driver's declared
 *   capabilities, and an unproven driver. Where Ork has a fallback (report,
 *   permissions, mid-turn messages) nothing is refused. Descriptors are fakes.
 */

import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { type DriverNeeds, driverRefusals } from "../src/index.ts";

const ABLE = {
  questions: true,
  permissionPrompt: true,
  price: true,
  midTurnMessages: true,
  reportSchema: true,
  turnLimit: true,
  mcpServers: true,
};

const fake = (
  id: DriverNeeds["id"],
  capabilities: Partial<DriverNeeds["capabilities"]> = {},
  proven = true,
): DriverNeeds => ({
  id,
  proven,
  onePerCheckout: false,
  capabilities: { ...ABLE, ...capabilities },
});

const workflowOf = (nodes: string, defaults = ""): Workflow => {
  const parsed = parseWorkflow(
    `schemaVersion: 1\nname: t\n${defaults}nodes:\n${nodes}`,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const BARE = `  build:
    type: claude.worker
    prompt: go
`;

const none = fake("open-code", {
  turnLimit: false,
  price: false,
  questions: false,
});

const messages = (workflow: Workflow, driver: DriverNeeds): string[] =>
  driverRefusals(workflow, [driver], { override: driver.id }).map(
    r => r.message,
  );

describe("what a node needs of its driver", () => {
  it("refuses maxTurns on a driver with no turn limit, naming both", () => {
    const w = workflowOf(`${BARE}    maxTurns: 5\n`);
    expect(messages(w, none)).toEqual([
      "node `build` sets maxTurns, but driver `open-code` has no turn limit",
    ]);
    expect(messages(w, fake("open-code", { turnLimit: true }))).toEqual([]);
  });

  it("refuses budgetUsd on a driver that reports no dollars, and says RFC-015", () => {
    const w = workflowOf(`${BARE}    budgetUsd: 2\n`);
    const [only, ...rest] = messages(w, fake("command-code", { price: false }));
    expect(rest).toEqual([]);
    expect(only).toContain("node `build` sets budgetUsd");
    expect(only).toContain("driver `command-code`");
    expect(only).toContain("RFC-015");
  });

  it("refuses the run's limits.budgetUsd on a driver that reports no dollars", () => {
    const w = workflowOf(BARE, "limits:\n  budgetUsd: 5\n");
    expect(messages(w, fake("command-code", { price: false }))).toEqual([
      "node `build` runs under the workflow's limits.budgetUsd, but driver `command-code` does not report cost in dollars, so the budget can't be kept (a token budget comes with RFC-015)",
    ]);
    expect(messages(w, fake("command-code"))).toEqual([]);
  });

  it("refuses a node's own MCP servers on a driver that does not load them", () => {
    const own = workflowOf(`${BARE}    mcp: [docs]\n`);
    const deaf = fake("command-code", { mcpServers: false });
    expect(messages(own, deaf)).toEqual([
      "node `build` names MCP servers (`mcp`), but driver `command-code` does not load a node's own MCP servers",
    ]);
    expect(
      messages(workflowOf(BARE, "defaults:\n  mcp: [docs]\n"), deaf),
    ).toHaveLength(1);
    expect(messages(own, fake("command-code"))).toEqual([]);
  });

  it("refuses an owner and a node it owns sharing a one-per-checkout driver's checkout", () => {
    const w = workflowOf(`  lead:
    type: claude.leader
    prompt: go
  part:
    type: claude.worker
    parent: lead
    isolation: shared
    prompt: go
`);
    const one = { ...fake("command-code"), onePerCheckout: true };
    const found = driverRefusals(w, [one], { override: "command-code" });
    expect(found.map(r => r.node)).toEqual(["lead"]);
    expect(found[0]?.message).toContain(
      "node `lead` runs on driver `command-code`",
    );
    expect(found[0]?.message).toContain("never finish");
    expect(
      driverRefusals(w, [one], { override: "command-code", only: "part" }),
    ).toHaveLength(1);
    expect(
      driverRefusals(w, [fake("command-code")], { override: "command-code" }),
    ).toEqual([]);
  });

  it("reads a default turn limit and budget as the node's own", () => {
    const w = workflowOf(BARE, "defaults:\n  maxTurns: 3\n  budgetUsd: 1\n");
    expect(messages(w, none)).toHaveLength(2);
  });

  it("refuses delegation (and so owner questions) without questions", () => {
    const owner = workflowOf(`  lead:
    type: claude.leader
    prompt: go
    questions: owner
  part:
    type: claude.worker
    parent: lead
    prompt: go
`);
    expect(messages(owner, none)).toEqual([
      "node `lead` delegates to the nodes it owns, but driver `open-code` does not reach Ork's tools (ask_user, delegate, messages)",
    ]);
    expect(messages(owner, fake("open-code"))).toEqual([]);
  });

  it("refuses a driver not yet proven, in words naming both", () => {
    expect(messages(workflowOf(BARE), fake("command-code", {}, false))).toEqual(
      [
        "node `build` runs on driver `command-code`, which is not yet proven on a real session",
      ],
    );
  });

  it("does not refuse where Ork has a fallback", () => {
    const w = workflowOf(
      `${BARE}    output:\n      schema:\n        verdict: [a, b]\n    tools:\n      allow: [Read]\n`,
    );
    const bare = fake("open-code", {
      permissionPrompt: false,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: false,
      price: false,
      questions: false,
    });
    expect(messages(w, bare)).toEqual([]);
  });

  it("checks each node against its own driver, `--driver` first", () => {
    const w = workflowOf(`${BARE}    maxTurns: 5\n    driver: open-code\n`);
    const drivers = [none, fake("claude-code")];
    expect(driverRefusals(w, drivers, {})).toHaveLength(1);
    expect(driverRefusals(w, drivers, { override: "claude-code" })).toEqual([]);
    expect(driverRefusals(w, drivers, { only: "elsewhere" })).toEqual([]);
  });

  it("checks the ready driver for a node that names none, and nothing without one", () => {
    const w = workflowOf(`${BARE}    maxTurns: 5\n`);
    expect(driverRefusals(w, [none], { ready: "open-code" })).toHaveLength(1);
    expect(driverRefusals(w, [none], {})).toEqual([]);
  });
});
