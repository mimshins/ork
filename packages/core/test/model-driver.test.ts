/**
 * @file Tests for a model that names its driver (`claude-code.opus`, RFC-015):
 *   the prefix picks the session's driver over `--driver`, the tool gets the
 *   rest, a plain model stays plain, a prefix against the node's `driver` fails
 *   compiling, and a sub-agent is refused on a driver without subagents.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  compileWorkflow,
  type DriverNeeds,
  driverRefusals,
  modelDriver,
  namingNoDriver,
  nodeDriver,
  planNodeSession,
} from "../src/index.ts";

const workflowOf = (lines: string[]): Workflow => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const nodeOf = (workflow: Workflow, id: string) => {
  const node = workflow.nodes[id];
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
};

const planned = (workflow: Workflow, id: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-model-driver-"));
  const plan = planNodeSession(workflow, id, {
    cwd: root,
    inputs: {},
    inPlace: true,
    home: root,
  });
  if (!plan.ok) throw new Error(plan.error);
  return plan;
};

const errorsOf = (workflow: Workflow) =>
  compileWorkflow(workflow)
    .diagnostics.filter(d => d.severity === "error")
    .map(({ code, message, path: at }) => ({ code, message, path: at }));

const ABLE = {
  questions: true,
  permissionPrompt: true,
  price: true,
  midTurnMessages: true,
  reportSchema: true,
  turnLimit: true,
  mcpServers: true,
  subagents: true,
};

const fake = (id: DriverNeeds["id"], subagents: boolean): DriverNeeds => ({
  id,
  proven: true,
  onePerCheckout: false,
  capabilities: { ...ABLE, subagents },
});

const DRIVERS = [
  fake("claude-code", true),
  fake("open-code", false),
  fake("command-code", false),
];

const WORKER = (model: string) => [
  "nodes:",
  "  build:",
  "    type: agent.worker",
  "    prompt: go",
  `    model: ${model}`,
];

describe("a model that names its driver", () => {
  it("runs on the driver it names, over `--driver`, and the tool gets the rest", () => {
    const w = workflowOf(WORKER("claude-code.opus"));
    expect(nodeDriver(nodeOf(w, "build"), w, { override: "open-code" })).toBe(
      "claude-code",
    );
    const plan = planned(w, "build");
    expect([plan.pinned, plan.spec.model]).toEqual(["claude-code", "opus"]);
  });

  it("keeps a plain model with a slash or dot plain, on the run's driver", () => {
    const w = workflowOf(WORKER("deepseek/deepseek-v4.1-flash"));
    expect(modelDriver("deepseek/deepseek-v4.1-flash")).toEqual({
      driver: undefined,
      model: "deepseek/deepseek-v4.1-flash",
    });
    expect(nodeDriver(nodeOf(w, "build"), w, { override: "open-code" })).toBe(
      "open-code",
    );
    const plan = planned(w, "build");
    expect([plan.pinned, plan.spec.model]).toEqual([
      undefined,
      "deepseek/deepseek-v4.1-flash",
    ]);
  });

  it("passes everything after the first dot to the tool as it is", () => {
    expect(modelDriver("command-code.deepseek/deepseek-v4.1-flash")).toEqual({
      driver: "command-code",
      model: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("pins a node through `defaults.model`, so it names a driver", () => {
    const w = workflowOf([
      "defaults: { model: open-code.anthropic/claude-sonnet-5-5 }",
      "nodes:",
      "  build: { type: agent.worker, prompt: go }",
      "  other: { type: agent.worker, prompt: go, model: sonnet }",
    ]);
    expect(namingNoDriver(w)).toEqual(["other"]);
    expect(nodeDriver(nodeOf(w, "build"), w, {})).toBe("open-code");
  });

  it("fails compiling when the prefix and the node's `driver` disagree, naming both", () => {
    const w = workflowOf([
      ...WORKER("claude-code.opus"),
      "    driver: open-code",
    ]);
    expect(errorsOf(w)).toEqual([
      {
        code: "model.driver",
        message:
          "model `claude-code.opus` names driver `claude-code`, but the node sets `driver: open-code`; remove one, or make them agree",
        path: ["nodes", "build", "model"],
      },
    ]);
  });

  it("fails compiling when `defaults.model` names another driver than the node's", () => {
    const w = workflowOf([
      "defaults: { model: claude-code.opus }",
      "nodes:",
      "  build: { type: agent.worker, prompt: go, driver: open-code }",
    ]);
    expect(errorsOf(w)).toEqual([
      {
        code: "model.driver",
        message:
          "model `claude-code.opus` names driver `claude-code`, but the node sets `driver: open-code`; remove one, or make them agree (the model is `defaults.model`)",
        path: ["nodes", "build", "driver"],
      },
    ]);
  });

  it("compiles a prefix that agrees with the node's `driver`", () => {
    const w = workflowOf([...WORKER("open-code.x/y"), "    driver: open-code"]);
    expect(errorsOf(w)).toEqual([]);
  });
});

const LEAD = (leader: string, helper = "") => [
  "nodes:",
  "  lead:",
  "    type: agent.leader",
  "    prompt: go",
  ...(leader === "" ? [] : [`    model: ${leader}`]),
  "  helper:",
  "    type: agent.subagent",
  "    parent: lead",
  "    description: helps",
  ...(helper === "" ? [] : [`    model: ${helper}`]),
];

const refusals = (workflow: Workflow, override?: DriverNeeds["id"]) =>
  driverRefusals(workflow, DRIVERS, { override });

describe("a sub-agent and its leader's driver", () => {
  it("is refused under a leader whose driver runs no subagents, naming it", () => {
    expect(refusals(workflowOf(LEAD("open-code.x/y")))).toEqual([
      {
        node: "helper",
        message:
          "sub-agent `helper` runs in `lead`'s session on driver `open-code`, which does not run subagents",
      },
    ]);
  });

  it("follows the leader's driver as `--driver` sets it", () => {
    expect(refusals(workflowOf(LEAD("")), "command-code")).toEqual([
      {
        node: "helper",
        message:
          "sub-agent `helper` runs in `lead`'s session on driver `command-code`, which does not run subagents",
      },
    ]);
    expect(refusals(workflowOf(LEAD("")), "claude-code")).toEqual([]);
  });

  it("is refused when its model names another driver than its leader's", () => {
    expect(
      refusals(workflowOf(LEAD("claude-code.opus", "open-code.x/y"))),
    ).toEqual([
      {
        node: "helper",
        message:
          "sub-agent `helper` runs in `lead`'s session on driver `claude-code`, but its model `open-code.x/y` names driver `open-code`",
      },
    ]);
  });

  it("hands the leader's tool the sub-agent's model without its prefix", () => {
    const plan = planned(
      workflowOf(LEAD("claude-code.opus", "claude-code.haiku")),
      "lead",
    );
    expect(plan.spec.agents?.["helper"]?.model).toBe("haiku");
  });
});
