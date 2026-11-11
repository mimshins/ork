/**
 * @file Tests for `once: true` on a tool node and a `verify:` step: a check
 *   that passed on identical files is skipped and the run records
 *   `verify.skipped` with the earlier pass; a failure records nothing, so the
 *   check runs again; `ORK_ONCE=off` always runs it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecuteContext, NodeResult } from "@krapht/ork-core";
import type { Node, Verify } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { toolExecutor } from "../src/index.ts";
import type { ToolRunner } from "../src/tool-command.ts";
import { runStep } from "../src/verify.ts";

/** A git repository with one untracked file. */
const repo = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-nodes-once-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(path.join(root, ".gitignore"), "runs/\n");
  writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
  return root;
};

type Skip = { check: string; at: string; who: string };

/** A runner that counts its runs and exits with `code`. */
const counting = (code: number) => {
  const state = { runs: 0 };
  const runner: ToolRunner = () => {
    state.runs += 1;
    return Promise.resolve({ exitCode: code, stdout: "ok", stderr: "" });
  };
  return { state, runner };
};

const contextOf = (cwd: string, node: Node, skips: Skip[]): ExecuteContext => ({
  runId: "r1",
  id: "n",
  node,
  workflow: { schemaVersion: 1, name: "wf", nodes: { n: node } },
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
  skipped: (check, { at, who }) => {
    skips.push({ check, at, who });
  },
});

/** Runs a `once: true` tool node `times` times in `cwd`. */
const runTimes = async (
  cwd: string,
  times: number,
  { code = 0, environ = {} }: { code?: number; environ?: NodeJS.ProcessEnv },
) => {
  const { state, runner } = counting(code);
  const skips: Skip[] = [];
  const node: Node = { type: "tool.shell", command: "pnpm check", once: true };
  const execute = toolExecutor(runner, { environ });
  // One after another: each run reads the passes the one before recorded.
  const go = async (left: number): Promise<NodeResult[]> =>
    left === 0
      ? []
      : [await execute(contextOf(cwd, node, skips)), ...(await go(left - 1))];
  const results = await go(times);
  return { runs: state.runs, skips, results };
};

describe("once: true on a tool node", () => {
  it("skips a check that passed on the same files, with the event", async () => {
    const { runs, skips, results } = await runTimes(repo(), 2, {});
    expect(runs).toBe(1);
    expect(results.map(result => result.ok)).toEqual([true, true]);
    expect(results[1]?.output).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(skips.map(({ check, who }) => [check, who])).toEqual([
      ["pnpm check", "r1/n"],
    ]);
    expect(skips.map(({ at }) => Number.isNaN(Date.parse(at)))).toEqual([
      false,
    ]);
  });

  it("runs again after an edit", async () => {
    const root = repo();
    await runTimes(root, 1, {});
    writeFileSync(path.join(root, "a.ts"), "export const a = 2;\n");
    const { runs, skips } = await runTimes(root, 1, {});
    expect({ runs, skips }).toEqual({ runs: 1, skips: [] });
  });

  it("records nothing for a failed check, which runs again", async () => {
    const { runs, skips, results } = await runTimes(repo(), 2, { code: 1 });
    expect(runs).toBe(2);
    expect(skips).toEqual([]);
    expect(results.map(result => result.ok)).toEqual([false, false]);
  });

  it("always runs with ORK_ONCE=off", async () => {
    const { runs, skips } = await runTimes(repo(), 2, {
      environ: { ORK_ONCE: "off" },
    });
    expect({ runs, skips }).toEqual({ runs: 2, skips: [] });
  });
});

describe("once: true on verify:", () => {
  it("passes through to the step's command, which a pass skips", async () => {
    const root = repo();
    const { state, runner } = counting(0);
    const skips: Skip[] = [];
    const verify: Verify = { command: "pnpm check:changed", once: true };
    const worker: Node = { type: "agent.worker", prompt: "Fix", verify };
    const tool = toolExecutor(runner, { environ: {} });
    const step = { name: "verify" as const, try: 1 };
    const first = await runStep(
      tool,
      contextOf(root, worker, skips),
      verify,
      step,
    );
    const second = await runStep(
      tool,
      contextOf(root, worker, skips),
      verify,
      step,
    );
    expect([first.ok, second.ok, state.runs]).toEqual([true, true, 1]);
    expect(skips.map(skip => skip.check)).toEqual(["pnpm check:changed"]);
  });
});
