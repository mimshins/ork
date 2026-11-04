/**
 * @file Tests for a tool node's `script:` (RFC-006), run for real: values come
 *   through `env:`, the default interpreter stops at the first failure, any
 *   program can run one, and no copy of it stays behind.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecuteContext, RuntimeEvent } from "@krapht/ork-core";
import type { Node, ToolNode, Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  missingEnv,
  neededPrograms,
  secretsOf,
  spawnTool,
  toolExecutor,
} from "../src/index.ts";
import { commandLineOf } from "../src/tool-command.ts";

const context = (
  node: Node,
): ExecuteContext & { events: RuntimeEvent[]; runFolder: string } => {
  const events: RuntimeEvent[] = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-tool-script-"));
  const workflow: Workflow = {
    schemaVersion: 1,
    name: "wf",
    nodes: { n: node },
  };
  return {
    runId: "r1",
    id: "n",
    node,
    workflow,
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, "runs"),
    runFolder: path.join(cwd, "runs", ".output"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: event => {
      events.push(event);
    },
    signal: new AbortController().signal,
    events,
  };
};

const run = async (fields: Partial<ToolNode>) => {
  const node: Node = { type: "tool.shell", ...fields };
  const given = context(node);
  const result = await toolExecutor(spawnTool, { environ: {} })(given);
  return { result, given };
};

const leftIn = (folder: string): string[] =>
  existsSync(folder) ? readdirSync(folder) : [];

describe("a tool node's script", () => {
  it("reads values through env:, and runs where the node does", async () => {
    const { result, given } = await run({
      script: 'echo "$WHO in $(basename "$PWD")"',
      env: { WHO: "someone" },
    });
    expect(result.ok).toBe(true);
    expect(result.output["stdout"]).toBe(
      `someone in ${path.basename(given.cwd)}\n`,
    );
  });

  it("stops at the first failure by default", async () => {
    const { result } = await run({ script: "false\necho not reached" });
    expect(result.ok).toBe(false);
    expect(result.output["stdout"]).toBe("");
  });

  it("fails on a variable that is not set by default", async () => {
    const { result } = await run({ script: 'echo "$NOT_SET"' });
    expect(result.ok).toBe(false);
    expect(String(result.output["stderr"])).toContain("NOT_SET");
  });

  it("runs under the interpreter it names", async () => {
    const { result } = await run({
      script: "console.log(process.env.WHO.toUpperCase());",
      interpreter: "node",
      env: { WHO: "someone" },
    });
    expect(result.output["stdout"]).toBe("SOMEONE\n");
  });

  it("returns JSON as any program does", async () => {
    const { result } = await run({
      script: `echo '{"state":"OPEN"}'`,
      output: { format: "json" },
    });
    expect(result.output["json"]).toEqual({ state: "OPEN" });
  });

  it("is checked against the allow list by its interpreter", async () => {
    const { result } = await run({ script: "true", allow: ["bash"] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("allow list");
  });

  it("leaves no copy behind", async () => {
    const { given } = await run({ script: "true" });
    expect(leftIn(given.runFolder)).toEqual([]);
  });

  it("records that it ran, without its text", async () => {
    const { given } = await run({ script: "echo a-distinct-word" });
    const called = given.events.find(event => event.type === "tool.called");
    expect(called).toMatchObject({ input: { command: "sh -eu <script>" } });
    expect(JSON.stringify(given.events)).not.toContain("a-distinct-word");
  });

  it("never renders its interpreter", async () => {
    const { result } = await run({
      interpreter: "sh '{''{inputs.x}}'",
      script: "exit 0",
    });
    expect(String(result.output["stderr"])).toContain("{{inputs.x}}");
  });

  it("does not ask about a relative program, which a checkout may yet have", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "t",
      nodes: {
        a: { type: "tool.shell", command: "./node_modules/.bin/vitest run" },
        b: {
          type: "tool.shell",
          interpreter: "./venv/bin/python",
          script: "1",
        },
        c: { type: "tool.shell", command: "/an/absolute/program" },
      },
    };
    expect(neededPrograms(workflow).map(needed => needed.program)).toEqual([
      "/an/absolute/program",
    ]);
  });

  it("keeps a failure's reason short however long its last line", async () => {
    const { result } = await run({
      interpreter: "node",
      script: 'process.stderr.write("x".repeat(200000)); process.exit(1)',
    });
    expect(String(result.error).length).toBeLessThan(2000);
  });

  it("names its interpreter as the program a run needs", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "wf",
      nodes: {
        a: { type: "tool.shell", script: "x", interpreter: "python3 -u" },
        b: { type: "tool.shell", script: "x" },
        c: { type: "tool.shell", command: "make test" },
      },
    };
    expect(neededPrograms(workflow).map(needed => needed.program)).toEqual([
      "python3",
      "sh",
      "make",
    ]);
    expect(commandLineOf({})).toBeUndefined();
  });

  it("counts a step's program and variables with the rest", () => {
    const workflow: Workflow = {
      schemaVersion: 1,
      name: "wf",
      nodes: {
        w: {
          type: "claude.worker",
          verify: {
            command: "pnpm test",
            env: { T: "{{env.PROBE_SECRET}}" },
          },
        },
      },
    };
    expect(neededPrograms(workflow)).toEqual([
      { node: "w", type: "tool.shell", program: "pnpm" },
    ]);
    expect(missingEnv(workflow, {})).toEqual([
      { variable: "PROBE_SECRET", nodes: ["w"] },
    ]);
    expect(secretsOf(workflow, { PROBE_SECRET: "a-value-to-mask" })).toEqual([
      "a-value-to-mask",
    ]);
  });
});
