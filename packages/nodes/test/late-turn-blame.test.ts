/**
 * @file Tests that a resumed turn blames the run's dollar budget only for what
 *   it spent itself. Claude Code reports a resumed session's cost as the
 *   session's total (ADR-046) while the turn's cap is what was left, so a turn
 *   its own token cap stopped is not taken for one the run's budget stopped.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  endFor,
  type ExecuteContext,
  type NodeReport,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";
import type { Node } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/claude.ts";

const usageOf = (costUsd: number, inputTokens: number): SessionUsage => ({
  costUsd,
  inputTokens,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
});

const PASS: NodeReport = {
  status: "pass",
  summary: "done",
  artifacts: {},
  fields: {},
};

/** The first turn: a report, $0.60 and 15 counted tokens. */
const FIRST: SessionOutcome = {
  subtype: "success",
  sessionId: "s1",
  report: PASS,
  text: "",
  usage: usageOf(0.6, 10),
  errors: [],
};

/** The resumed turn: no report, ended by a cap, with the session's total cost. */
const capped = (costUsd: number, inputTokens: number): SessionOutcome => ({
  subtype: "error_max_budget_usd",
  sessionId: "s1",
  report: null,
  text: "",
  usage: usageOf(costUsd, inputTokens),
  errors: ["reached its budget"],
  end: endFor("budget_limit", {}, "reached its budget"),
});

const finished = async function* (
  outcome: SessionOutcome,
): AsyncGenerator<RuntimeEvent> {
  await Promise.resolve();
  yield { type: "session.finished", outcome };
};

/**
 * A worker under a run budget of $1 and its own cap of 1000 tokens, whose first
 * report fails its check and whose resumed turn ends as `resumed`. The run's
 * budget has not yet counted the node's spend, as the scheduler's has not.
 */
const resumedUnderRunBudget = async (resumed: SessionOutcome) => {
  const specs: SessionSpec[] = [];
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: spec => {
      specs.push(spec);
      return {
        events: finished(specs.length === 1 ? FIRST : resumed),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  const execute = claudeExecutor({
    runtimeFor: () => Promise.resolve(runtime),
    readyDriver: "claude-code",
    inPlace: true,
    steps: () =>
      Promise.resolve({ ok: false, output: {}, error: "the check failed" }),
  });
  const node: Node = {
    type: "agent.worker",
    prompt: "Fix",
    budgetTokens: 1000,
    verify: { command: "pnpm test" },
  };
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-late-blame-"));
  const context: ExecuteContext = {
    runId: "r1",
    id: "fix",
    node,
    workflow: {
      schemaVersion: 1,
      name: "t",
      limits: { budgetUsd: 1 },
      nodes: { fix: node },
    },
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, "runs"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: 1,
    budgetLeftNow: () => 1,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: () => {},
    signal: new AbortController().signal,
  };
  const result = await execute(context);
  return { result, specs };
};

describe("a resumed turn's blame for the run's budget", () => {
  it("offers the resumed turn what is left: $0.40 and 985 tokens", async () => {
    const { specs } = await resumedUnderRunBudget(capped(0.7, 1000));
    expect(specs[1]).toMatchObject({ budgetTokens: 985, resume: "s1" });
    expect(specs[1]?.budgetUsd).toBeCloseTo(0.4);
  });

  it("does not stop the run when the node's token cap ended the turn", async () => {
    // $0.70 is the session's total: the turn spent $0.10 of its $0.40.
    const { result } = await resumedUnderRunBudget(capped(0.7, 1000));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("stopsAs");
    expect(result).not.toHaveProperty("limited");
  });

  it("counts a total below the prior cost whole, not as a negative spend", async () => {
    // $0.45 < the $0.60 already spent: the turn spent $0.45 of its $0.40.
    const { result } = await resumedUnderRunBudget(capped(0.45, 10));
    expect(result).toMatchObject({
      stopsAs: "budget_exhausted",
      limited: "the run's budget of $1 is spent",
    });
  });

  it("stops the run when the turn spent what was left of its dollars", async () => {
    const { result } = await resumedUnderRunBudget(capped(1, 10));
    expect(result).toMatchObject({
      ok: false,
      stopsAs: "budget_exhausted",
      limited: "the run's budget of $1 is spent",
    });
  });
});
