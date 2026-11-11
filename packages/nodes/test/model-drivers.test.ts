/**
 * @file Tests for a session's driver from its model (`claude-code.opus`,
 *   RFC-015) in a run: the prefix wins over `--driver`, a plain model runs on
 *   the run's driver, an item's `{{item.model}}` starts that item on the driver
 *   it renders, and that driver's fit is checked on the rendered value.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  compileWorkflow,
  type DriverNeeds,
  type RunEvent,
  startRun,
} from "@krapht/ork-core";
import { type Driver, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/index.ts";

const usage = {
  costUsd: 0.5,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

type Started = { nodeId: string; driver: Driver; model: string | undefined };

/** A runtime per driver that records which driver started which session. */
const runtimeFor = (started: Started[]) => (driver: Driver) => {
  const runtime: AgentRuntime = {
    driver,
    start: spec => {
      started.push({ nodeId: spec.nodeId, driver, model: spec.model });
      const sessionId = `s${String(started.length)}`;
      return {
        events: (async function* () {
          await Promise.resolve();
          yield {
            type: "session.started" as const,
            sessionId,
            model: spec.model ?? "default",
          };
          yield {
            type: "session.finished" as const,
            outcome: {
              subtype: "success" as const,
              sessionId,
              report: {
                status: "pass",
                summary: "ok",
                artifacts: {},
                fields: {},
              },
              text: "",
              usage,
              errors: [],
            },
          };
        })(),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  return Promise.resolve(runtime);
};

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

/** Command Code without a turn limit, the others able. */
const DRIVERS: DriverNeeds[] = [
  "claude-code" as const,
  "open-code" as const,
  "command-code" as const,
].map(id => ({
  id,
  proven: true,
  onePerCheckout: false,
  capabilities: { ...ABLE, turnLimit: id !== "command-code" },
}));

/** Runs a workflow of these lines, `--driver` set to `override` if given. */
const run = async (lines: string[], override?: Driver) => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "defaults: { isolation: shared }",
      ...lines,
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  const started: Started[] = [];
  const events: RunEvent[] = [];
  const result = await startRun({
    graph,
    inputs: {},
    cwd: mkdtempSync(path.join(tmpdir(), "ork-model-drivers-")),
    executors: {
      "agent.worker": claudeExecutor({
        runtimeFor: runtimeFor(started),
        readyDriver: "claude-code",
        ...(override === undefined ? {} : { driver: override }),
        drivers: DRIVERS,
        inPlace: true,
      }),
    },
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
    },
  }).done;
  const sorted = started.toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
  return { result, started: sorted, events };
};

const worker = (model: string, more: string[] = []) => [
  "nodes:",
  "  build:",
  "    type: agent.worker",
  "    prompt: go",
  `    model: "${model}"`,
  ...more,
];

const ITEMS = [
  "    forEach:",
  "      items:",
  "        - { model: command-code.deepseek/deepseek-v4.1-flash }",
  "        - { model: sonnet }",
];

describe("a session's driver from its model", () => {
  it("runs a prefixed model on its driver even under `--driver`", async () => {
    const { result, started } = await run(
      worker("claude-code.opus"),
      "open-code",
    );
    expect(result.status).toBe("succeeded");
    expect(started).toEqual([
      { nodeId: "build", driver: "claude-code", model: "opus" },
    ]);
  });

  it("runs a plain model on the run's driver", async () => {
    const { started } = await run(
      worker("deepseek/deepseek-v4.1-flash"),
      "open-code",
    );
    expect(started).toEqual([
      {
        nodeId: "build",
        driver: "open-code",
        model: "deepseek/deepseek-v4.1-flash",
      },
    ]);
  });

  it("starts each item on the driver its rendered model names", async () => {
    const { result, started } = await run(worker("{{item.model}}", ITEMS));
    expect(result.status).toBe("succeeded");
    expect(started).toEqual([
      {
        nodeId: "build.0",
        driver: "command-code",
        model: "deepseek/deepseek-v4.1-flash",
      },
      { nodeId: "build.1", driver: "claude-code", model: "sonnet" },
    ]);
  });

  it("checks an item's driver on the rendered model, failing only that item", async () => {
    const { result, started, events } = await run(
      worker("{{item.model}}", ["    maxTurns: 5", ...ITEMS]),
    );
    expect(result.status).toBe("failed");
    expect(started.map(s => s.nodeId)).toEqual(["build.1"]);
    expect(JSON.stringify(events)).toContain(
      "node `build` sets maxTurns, but driver `command-code` has no turn limit",
    );
  });

  it("fails an item whose rendered prefix contradicts the node's `driver`", async () => {
    const { started, events } = await run(
      worker("{{item.model}}", ["    driver: claude-code", ...ITEMS]),
    );
    expect(started.map(s => s.nodeId)).toEqual(["build.1"]);
    expect(JSON.stringify(events)).toContain(
      "`build.0`: model `command-code.deepseek/deepseek-v4.1-flash` names driver `command-code`, but the node sets `driver: claude-code`; remove one, or make them agree",
    );
  });
});
