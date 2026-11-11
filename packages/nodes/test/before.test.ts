/**
 * @file Tests for `before:` (RFC-006), with a real program and a stand-in
 *   session: it runs in the node's checkout before the session, a failure
 *   spends no model turn, and the prompt can read what it gave.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AgentRuntime,
  ExecuteContext,
  RuntimeEvent,
  SessionSpec,
} from "@krapht/ork-core";
import type { Node, Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/claude.ts";
import { spawnTool, toolExecutor } from "../src/index.ts";

const USAGE = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

const passing = async function* (): AsyncGenerator<RuntimeEvent> {
  await Promise.resolve();
  yield {
    type: "session.finished",
    outcome: {
      subtype: "success",
      sessionId: "s1",
      report: { status: "pass", summary: "ok", artifacts: {}, fields: {} },
      text: "",
      usage: USAGE,
      errors: [],
    },
  };
};

const runNode = async (
  node: Node,
  defaults?: Workflow["defaults"],
  prepare?: (cwd: string) => void,
  over: Partial<ExecuteContext> = {},
) => {
  const specs: SessionSpec[] = [];
  const runtime: AgentRuntime = {
    driver: "open-code",
    start: spec => {
      specs.push(spec);
      return {
        events: passing(),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  const execute = claudeExecutor({
    runtimeFor: () => Promise.resolve(runtime),
    readyDriver: "open-code",
    inPlace: true,
    steps: toolExecutor(spawnTool, { environ: {} }),
  });
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-before-"));
  prepare?.(cwd);
  const context: ExecuteContext = {
    runId: "r1",
    id: "w",
    node,
    workflow: {
      schemaVersion: 1,
      name: "t",
      nodes: { w: node },
      ...(defaults === undefined ? {} : { defaults }),
    },
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, "runs"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: () => {},
    signal: new AbortController().signal,
    ...over,
  };
  const result = await execute(context);
  return { result, specs };
};

/** Stops a node soon after its step has started. */
const stopOnToolCall = (stop: AbortController) => (event: RuntimeEvent) => {
  if (event.type === "tool.called") {
    setTimeout(() => {
      stop.abort();
    }, 100);
  }
};

describe("before:", () => {
  it("runs in the checkout, and its output reaches the prompt", async () => {
    const { result, specs } = await runNode(
      {
        type: "agent.worker",
        prompt: "Here is the setup: {{before.stdout}}",
        before: { script: "cat seen.txt" },
      },
      undefined,
      cwd => {
        writeFileSync(path.join(cwd, "seen.txt"), "from the checkout");
      },
    );
    expect(result.ok).toBe(true);
    expect(specs[0]?.prompt).toContain("Here is the setup: from the checkout");
  });

  it("gives a prompt its JSON", async () => {
    const { specs } = await runNode({
      type: "agent.worker",
      prompt: "Fix issue {{before.json.id}}",
      before: { command: "echo 42", output: { format: "json" } },
    });
    expect(specs[0]?.prompt).toBe("Fix issue");
    const { specs: withObject } = await runNode({
      type: "agent.worker",
      prompt: "Fix issue {{before.json.id}}",
      before: {
        script: `echo '{"id":7}'`,
        output: { format: "json" },
      },
    });
    expect(withObject[0]?.prompt).toBe("Fix issue 7");
  });

  it("spends no model turn when it fails", async () => {
    const { result, specs } = await runNode({
      type: "agent.worker",
      prompt: "Never sent",
      before: { script: "echo broken >&2\nexit 3" },
    });
    expect(specs).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.output["summary"]).toContain("its before step failed");
    expect(result.end).toMatchObject({
      kind: "command_failed",
      message: "sh exited with 3",
    });
    expect(result.output["before"]).toMatchObject({ exitCode: 3 });
  });

  it("starts no session if the node was stopped during it", async () => {
    const stop = new AbortController();
    const { result, specs } = await runNode(
      {
        type: "agent.worker",
        prompt: "Go",
        before: { script: "trap 'exit 0' TERM; sleep 5 & wait" },
      },
      undefined,
      undefined,
      {
        signal: stop.signal,
        emit: stopOnToolCall(stop),
      },
    );
    expect(specs).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.end?.kind).toBe("interrupted");
  });

  it("waits out a pause before its session starts", async () => {
    const waits: string[] = [];
    const { specs } = await runNode(
      { type: "agent.worker", prompt: "Go", before: { command: "true" } },
      undefined,
      undefined,
      {
        hold: {
          held: () => false,
          wait: at => {
            waits.push(at);
            return Promise.resolve();
          },
          watch: () => () => {},
        },
      },
    );
    expect(waits).toEqual(["start"]);
    expect(specs).toHaveLength(1);
  });

  it("comes from the defaults, and a node's own wins", async () => {
    const defaults = { before: { script: "echo from-defaults" } };
    const { specs: inherited } = await runNode(
      { type: "agent.worker", prompt: "{{before.stdout}}" },
      defaults,
    );
    expect(inherited[0]?.prompt).toBe("from-defaults");
    const { specs: own } = await runNode(
      {
        type: "agent.worker",
        prompt: "{{before.stdout}}",
        before: { script: "echo its-own" },
      },
      defaults,
    );
    expect(own[0]?.prompt).toBe("its-own");
  });

  it("masks what it reads from the user's variables", async () => {
    const execute = toolExecutor(spawnTool, {
      environ: { PROBE_TOKEN: "a-secret-value-1" },
    });
    const node: Node = {
      type: "agent.worker",
      before: {
        script: 'echo "$T"',
        env: { T: "{{env.PROBE_TOKEN}}" },
      },
    };
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-before-"));
    const result = await execute({
      runId: "r1",
      id: "w",
      node: { type: "tool.shell", ...node.before },
      workflow: { schemaVersion: 1, name: "t", nodes: { w: node } },
      inputs: {},
      outputs: {},
      input: undefined,
      round: 1,
      cwd,
      runDir: path.join(cwd, "runs"),
      workflowDir: cwd,
      projectRoot: cwd,
      budgetLeftUsd: undefined,
      human: {
        ask: () => Promise.resolve(""),
        permit: () => Promise.resolve({ allow: true }),
      },
      emit: () => {},
      signal: new AbortController().signal,
    });
    expect(result.output["stdout"]).toBe("[masked]\n");
  });
});
