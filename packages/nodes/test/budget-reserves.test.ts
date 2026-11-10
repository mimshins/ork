/**
 * @file Tests that Claude nodes running at the same time are not offered the
 *   same part of a run's budget (ADR-077): each sets aside the cap it starts
 *   with, a node with nothing left waits for one running beside it to finish,
 *   and a node lets its reserve go when its session ends.
 */

import { mkdtempSync } from "node:fs";
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

/** A run's budget as the scheduler keeps it: spent, and what is set aside. */
const budgetBook = (budgetUsd: number) => {
  let spent = 0;
  const reserves = new Map<string, number>();
  const waiters: (() => void)[] = [];
  const left = () =>
    budgetUsd - spent - [...reserves.values()].reduce((a, b) => a + b, 0);
  const reserve = (id: string, usd: number | undefined) => {
    const before = reserves.get(id) ?? 0;
    reserves.set(id, usd ?? 0);
    if ((usd ?? 0) < before) for (const wake of waiters.splice(0)) wake();
  };
  const hooks = (id: string): Partial<ExecuteContext> => ({
    budgetLeftUsd: left(),
    budgetLeftNow: left,
    reserveBudget: usd => {
      reserve(id, usd);
    },
    budgetFreed: () =>
      new Promise(resolve => {
        waiters.push(() => {
          resolve(true);
        });
      }),
    emit: (event: RuntimeEvent) => {
      if (event.type === "session.finished")
        spent += event.outcome.usage.costUsd;
    },
  });
  return { hooks, reserves };
};

/** A runtime whose sessions stay open until `finish` lets the oldest one go. */
const heldRuntime = () => {
  const specs: SessionSpec[] = [];
  const open: (() => void)[] = [];
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: spec => {
      specs.push(spec);
      const ended = new Promise<void>(resolve => {
        open.push(resolve);
      });
      return {
        events: (async function* () {
          await ended;
          yield {
            type: "session.finished" as const,
            outcome: {
              subtype: "success" as const,
              sessionId: `s${String(specs.length)}`,
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
  const finish = () => {
    open.shift()?.();
  };
  return { runtime, specs, finish };
};

const contextFor = (
  id: string,
  hooks: Partial<ExecuteContext>,
): ExecuteContext => {
  const node: Node = { type: "claude.worker", prompt: "Build", budgetUsd: 3 };
  const workflow: Workflow = {
    schemaVersion: 1,
    name: "t",
    nodes: { [id]: node },
  };
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-reserves-"));
  return {
    runId: "r1",
    id,
    node,
    workflow,
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, ".ork/runs/r1"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: () => {},
    signal: new AbortController().signal,
    ...hooks,
  };
};

/** Lets queued callbacks run. */
const tick = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

describe("nodes running at the same time under a run's budget", () => {
  it("never offers two sessions the same dollars, and the third waits", async () => {
    const book = budgetBook(5);
    const { runtime, specs, finish } = heldRuntime();
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "claude-code",
      inPlace: true,
    });
    const runs = ["a", "b", "c"].map(id =>
      execute(contextFor(id, book.hooks(id))),
    );
    await tick();
    // a takes its own cap, b what is left of the budget, c nothing yet.
    expect(specs.map(s => s.budgetUsd)).toEqual([3, 2]);

    finish();
    await tick();
    // a spent 0.5 of its 3 and let the rest go: c gets 5 - 0.5 - 2.
    expect(specs.map(s => s.budgetUsd)).toEqual([3, 2, 2.5]);
    expect(book.reserves.get("a")).toBe(0);

    finish();
    finish();
    const results = await Promise.all(runs);
    expect(results.map(r => r.ok)).toEqual([true, true, true]);
    expect([...book.reserves.values()]).toEqual([0, 0, 0]);
  });
});
