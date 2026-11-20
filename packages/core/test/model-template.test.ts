/**
 * @file Tests for a node's `model` and `effort` rendered when its session is
 *   planned (RFC-029): from an input or an earlier node's output, the driver a
 *   rendered prefix names, a `driver:` that disagrees, the empty-read rule (a
 *   node's output that gives nothing fails, a node run alone falls back with a
 *   warning), the one-word shape, and a sub-agent's model.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type NodeOutput,
  nodeDriver,
  type PlanOptions,
  planNodeSession,
} from "../src/index.ts";

const workflowOf = (lines: string[]): Workflow => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** A worker `work` with these settings, beside a `pick` that reports one. */
const worker = (settings: string[], defaults: string[] = []) =>
  workflowOf([
    "inputs: { level: { type: string, default: '' } }",
    ...defaults,
    "nodes:",
    "  pick: { type: agent.worker, prompt: Pick }",
    "  work:",
    "    type: agent.worker",
    "    prompt: Work",
    "    budgetUsd: 3",
    ...settings.map(line => `    ${line}`),
  ]);

const plan = (
  workflow: Workflow,
  run: {
    inputs?: PlanOptions["inputs"];
    outputs?: Record<string, NodeOutput>;
  } = {},
  id = "work",
) => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-model-template-"));
  return planNodeSession(workflow, id, {
    cwd: root,
    inPlace: true,
    home: root,
    inputs: run.inputs ?? {},
    ...(run.outputs === undefined ? {} : { outputs: run.outputs }),
  });
};

const planned = (...args: Parameters<typeof plan>) => {
  const result = plan(...args);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const failure = (...args: Parameters<typeof plan>): string => {
  const result = plan(...args);
  return result.ok ? "" : result.error;
};

/** The driver `work` takes with this written model, `open-code` ready. */
const pinned = (model: string) => {
  const workflow = worker([`model: "${model}"`]);
  const node = workflow.nodes["work"];
  if (node === undefined) throw new Error("no node work");
  return nodeDriver(node, workflow, { ready: "open-code" });
};

const FROM_PICK = 'model: "{{nodes.pick.output.model}}"';

describe("a model read from an earlier output", () => {
  it("renders the output, and its prefix picks the driver", () => {
    const result = planned(worker([FROM_PICK]), {
      outputs: { pick: { model: "claude-code.opus" } },
    });
    expect(result.spec.model).toBe("opus");
    expect(result.pinned).toBe("claude-code");
    // The budget is planned beside the rendered model, on its driver.
    expect(result.spec.budgetUsd).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it("fails when the node's driver: disagrees with the rendered prefix", () => {
    expect(
      failure(worker([FROM_PICK, "driver: open-code"]), {
        outputs: { pick: { model: "claude-code.opus" } },
      }),
    ).toContain(
      "names driver `claude-code`, but the node sets `driver: open-code`",
    );
  });

  it.each([{}, { pick: {} }, { pick: { model: "  " } }])(
    "fails when the node read gave nothing: %j",
    outputs => {
      expect(failure(worker([FROM_PICK]), { outputs })).toBe(
        "model: {{nodes.pick.output.model}} gave nothing: node pick has no output or an empty one",
      );
    },
  );

  it("fails an empty effort read from a node the same way", () => {
    expect(
      failure(worker(['effort: "{{nodes.pick.output.effort}}"']), {
        outputs: {},
      }),
    ).toBe(
      "effort: {{nodes.pick.output.effort}} gave nothing: node pick has no output or an empty one",
    );
  });

  it("fails a prefix-only render on its shape, not as empty", () => {
    expect(
      failure(worker(['model: "claude-code.{{nodes.pick.output.tier}}"']), {
        outputs: {},
      }),
    ).toBe(
      "`model: claude-code.{{nodes.pick.output.tier}}` gave `claude-code.`, which is not a model name",
    );
  });

  it("falls back to the default when the node runs alone, with a warning", () => {
    const result = planned(worker([FROM_PICK], ["defaults: { model: haiku }"]));
    expect(result.spec.model).toBe("haiku");
    expect(result.warnings).toEqual([
      "`model: {{nodes.pick.output.model}}` reads node pick, which is empty when the node runs alone, so the default applies",
    ]);
  });
});

describe("a model read from an input", () => {
  it("renders the input", () => {
    const result = planned(worker(['model: "claude-code.{{inputs.level}}"']), {
      inputs: { level: "sonnet" },
    });
    expect(result.spec.model).toBe("sonnet");
    expect(result.pinned).toBe("claude-code");
  });

  it("falls back to the default when it renders empty", () => {
    const result = planned(
      worker(
        ['model: "{{inputs.level}}"', 'effort: "{{inputs.level}}"'],
        ["defaults: { model: haiku, effort: low }"],
      ),
      { inputs: { level: "" }, outputs: {} },
    );
    expect(result.spec.model).toBe("haiku");
    expect(result.spec.effort).toBe("low");
  });

  it.each(["claude opus", "--dangerously-skip-permissions", '"opus"', "-x"])(
    "refuses %j, which is no model name",
    level => {
      expect(
        failure(worker(['model: "{{inputs.level}}"']), { inputs: { level } }),
      ).toContain("which is not a model name");
    },
  );

  it("refuses an effort that is no level", () => {
    expect(
      failure(worker(['effort: "{{inputs.level}}"']), {
        inputs: { level: "hard" },
      }),
    ).toContain("which is not an effort level");
  });
});

describe("a template model as written", () => {
  it("pins no driver, unless it writes the prefix", () => {
    expect(pinned("{{nodes.pick.output.model}}")).toBe("open-code");
    expect(pinned("{{inputs.level}}")).toBe("open-code");
    expect(pinned("claude-code.{{inputs.level}}")).toBe("claude-code");
  });

  it("gives a sub-agent the model its template renders", () => {
    const workflow = workflowOf([
      "inputs: { level: { type: string } }",
      "nodes:",
      "  lead: { type: agent.leader, prompt: Lead }",
      "  helper:",
      "    type: agent.subagent",
      "    parent: lead",
      "    description: Helps",
      '    model: "claude-code.{{inputs.level}}"',
    ]);
    const result = planned(workflow, { inputs: { level: "haiku" } }, "lead");
    expect(result.spec.agents?.["helper"]?.model).toBe("haiku");
  });

  it("fails a sub-agent whose model reads a node that gave nothing", () => {
    const workflow = workflowOf([
      "nodes:",
      "  pick: { type: agent.worker, prompt: Pick }",
      "  lead: { type: agent.leader, prompt: Lead }",
      "  helper:",
      "    type: agent.subagent",
      "    parent: lead",
      "    description: Helps",
      `    ${FROM_PICK}`,
    ]);
    expect(failure(workflow, { outputs: {} }, "lead")).toBe(
      "sub-agent `helper`: model: {{nodes.pick.output.model}} gave nothing: node pick has no output or an empty one",
    );
  });
});
