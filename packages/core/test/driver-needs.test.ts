/**
 * @file Tests for what a node needs of its driver (RFC-014): `maxTurns`,
 *   `budgetUsd`, delegation and owner questions against a driver's declared
 *   capabilities, and an unproven driver. Where Ork has a fallback (report,
 *   permissions, mid-turn messages) nothing is refused. A dollar budget on a
 *   driver with no dollars is a warning (RFC-015). Descriptors are fakes.
 */

import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  budgetWarnings,
  type DriverNeeds,
  driverRefusals,
} from "../src/index.ts";

const ABLE = {
  questions: true,
  permissionPrompt: true,
  price: true,
  midTurnMessages: true,
  reportSchema: true,
  turnLimit: true,
  mcpServers: true,
  subagents: true,
  readDenies: true,
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
    type: agent.worker
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

const warnings = (workflow: Workflow, driver: DriverNeeds): string[] =>
  budgetWarnings(workflow, [driver], { override: driver.id }).map(
    w => w.message,
  );

/** A real descriptor, so the refusals read are its capabilities'. */
const realDriver = (id: DriverNeeds["id"]): DriverNeeds => {
  const real = AGENT_DRIVERS.find(d => d.id === id);
  if (real === undefined) throw new Error(`no ${id} descriptor`);
  return real;
};

const realCodex = (): DriverNeeds => realDriver("codex");

describe("what a node needs of its driver", () => {
  it("refuses maxTurns on a driver with no turn limit, naming both", () => {
    const w = workflowOf(`${BARE}    maxTurns: 5\n`);
    expect(messages(w, none)).toEqual([
      "node `build` sets maxTurns, but driver `open-code` has no turn limit",
    ]);
    expect(messages(w, fake("open-code", { turnLimit: true }))).toEqual([]);
  });

  it("refuses no budget on a driver that reports no dollars", () => {
    const w = workflowOf(
      `${BARE}    budgetUsd: 2\n`,
      "limits:\n  budgetUsd: 5\n",
    );
    expect(messages(w, fake("command-code", { price: false }))).toEqual([]);
  });

  it("warns that only budgetTokens applies when a node sets budgetUsd alone on a driver with no dollars", () => {
    const unpriced = fake("command-code", { price: false });
    const only = workflowOf(`${BARE}    budgetUsd: 2\n`);
    expect(warnings(only, unpriced)).toEqual([
      "node `build` sets only budgetUsd, but driver `command-code` reports no dollars: only budgetTokens applies on command-code",
    ]);
    const both = workflowOf(
      `${BARE}    budgetUsd: 2\n    budgetTokens: 50000\n`,
    );
    expect(warnings(both, unpriced)).toEqual([]);
    expect(warnings(only, fake("command-code"))).toEqual([]);
  });

  it("warns that the run's limits.budgetUsd can't see a driver with no dollars", () => {
    const w = workflowOf(BARE, "limits:\n  budgetUsd: 5\n");
    expect(warnings(w, fake("command-code", { price: false }))).toEqual([
      "node `build` runs under the workflow's limits.budgetUsd, but driver `command-code` reports no dollars, so that limit can't see its sessions",
    ]);
    expect(warnings(w, fake("command-code"))).toEqual([]);
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

  it("refuses a path-scoped read deny on a driver with no read tool to gate, naming the gap", () => {
    const blind = fake("codex", { readDenies: false });
    const scoped = workflowOf(
      `${BARE}    tools:\n      deny: ["Read(./secrets/**)"]\n`,
    );
    expect(messages(scoped, blind)).toEqual([
      "node `build` denies `Read(./secrets/**)`, but driver `codex` has no read tool to gate, so a deny on a path can't hold (reads outside the worktree are not fenced)",
    ]);
    expect(messages(scoped, fake("claude-code"))).toEqual([]);
    // The project's rules count too; so do Glob and Grep.
    const project = workflowOf(
      BARE,
      'rules:\n  permissions:\n    deny: ["Grep(*.env)"]\n',
    );
    expect(messages(project, blind)).toHaveLength(1);
    expect(
      messages(
        workflowOf(`${BARE}    tools:\n      deny: ["Glob(.git/**)"]\n`),
        blind,
      ),
    ).toHaveLength(1);
  });

  it("lets a codex node deny what is not a path-scoped read", () => {
    const blind = fake("codex", { readDenies: false });
    const w = workflowOf(
      `${BARE}    tools:\n      deny: ["Bash(git push *)", "Grep", "Edit(./src/**)"]\n`,
    );
    expect(messages(w, blind)).toEqual([]);
  });

  it("refuses what the codex descriptor does not do: turns, its own MCP servers, sub-agents, a path-scoped read deny", () => {
    const codex = realCodex();
    const w = workflowOf(`  lead:
    type: agent.leader
    prompt: go
    maxTurns: 5
    mcp: [docs]
    tools:
      deny: ["Read(./secrets/**)"]
  helper:
    type: agent.subagent
    parent: lead
    description: helps
`);
    expect(messages(w, codex).map(m => m.split(",")[0])).toEqual([
      "node `lead` sets maxTurns",
      "node `lead` names MCP servers (`mcp`)",
      "node `lead` denies `Read(./secrets/**)`",
      "sub-agent `helper` runs in `lead`'s session on driver `codex`",
    ]);
    expect(messages(workflowOf(`${BARE}    budgetUsd: 2\n`), codex)).toEqual(
      [],
    );
    expect(warnings(workflowOf(`${BARE}    budgetUsd: 2\n`), codex)).toEqual([
      "node `build` sets only budgetUsd, but driver `codex` reports no dollars: only budgetTokens applies on codex",
    ]);
  });

  it("refuses an omp node while the real descriptor is unproven", () => {
    expect(messages(workflowOf(BARE), realDriver("omp"))).toEqual([
      "node `build` runs on driver `omp`, which is not yet proven on a real session",
    ]);
  });

  it("refuses what the omp descriptor does not do once proven: turns, its own MCP servers, sub-agents; not a path-scoped read deny", () => {
    const omp = { ...realDriver("omp"), proven: true };
    const w = workflowOf(`  lead:
    type: agent.leader
    prompt: go
    maxTurns: 5
    mcp: [docs]
    tools:
      deny: ["Read(./secrets/**)"]
  helper:
    type: agent.subagent
    parent: lead
    description: helps
`);
    expect(messages(w, omp).map(m => m.split(",")[0])).toEqual([
      "node `lead` sets maxTurns",
      "node `lead` names MCP servers (`mcp`)",
      "sub-agent `helper` runs in `lead`'s session on driver `omp`",
    ]);
    const priced = workflowOf(`${BARE}    budgetUsd: 2\n`);
    expect(messages(priced, omp)).toEqual([]);
    expect(warnings(priced, omp)).toEqual([]);
  });

  it("refuses an owner and a node it owns sharing a one-per-checkout driver's checkout", () => {
    const w = workflowOf(`  lead:
    type: agent.leader
    prompt: go
  part:
    type: agent.worker
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
    expect(messages(w, none)).toHaveLength(1);
    expect(warnings(w, none)).toHaveLength(1);
  });

  it("refuses delegation (and so owner questions) without questions", () => {
    const owner = workflowOf(`  lead:
    type: agent.leader
    prompt: go
    questions: owner
  part:
    type: agent.worker
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
