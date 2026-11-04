/**
 * @file Tests for `verify:` (RFC-006) with a stand-in session and a stand-in
 *   for the program: a report is accepted only when its check passes, a failure
 *   goes back to the same session within its attempts and budgets, and a
 *   session can't get past a check by what it reports.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ClaudeRuntime,
  ExecuteContext,
  NodeReport,
  NodeResult,
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import type { Node, Verify } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/claude.ts";

const USAGE = {
  costUsd: 0.5,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

const reportOf = (status: NodeReport["status"]): NodeReport => ({
  status,
  summary: `reported ${status}`,
  artifacts: {},
  fields: {},
});

const outcomeOf = (report: NodeReport | null): SessionOutcome => ({
  subtype: "success",
  sessionId: "s1",
  report,
  text: "",
  usage: USAGE,
  errors: [],
});

const sessionEvents = async function* (
  outcome: SessionOutcome,
): AsyncGenerator<RuntimeEvent> {
  await Promise.resolve();
  yield { type: "session.finished", outcome };
};

const FAILED: NodeResult = {
  ok: false,
  output: { exitCode: 1, stdout: "", stderr: "2 tests failed" },
  error: "pnpm exited with 1: 2 tests failed",
};
const PASSED: NodeResult = { ok: true, output: { exitCode: 0 } };

/** Runs a worker whose sessions report these, and whose checks answer these. */
const runVerified = async (given: {
  reports: readonly (NodeReport | null)[];
  checks: readonly NodeResult[];
  verify?: Partial<Verify>;
  over?: Partial<ExecuteContext>;
}) => {
  const specs: SessionSpec[] = [];
  const stepNodes: Node[] = [];
  const runtime: ClaudeRuntime = {
    driver: "sdk",
    start: spec => {
      const report = given.reports[specs.length] ?? null;
      specs.push(spec);
      return {
        events: sessionEvents(outcomeOf(report)),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  const execute = claudeExecutor({
    runtimeFor: () => Promise.resolve(runtime),
    inPlace: true,
    steps: context => {
      stepNodes.push(context.node);
      return Promise.resolve(
        given.checks[stepNodes.length - 1] ?? {
          ok: false,
          output: {},
          error: "no more checks",
        },
      );
    },
  });
  const node: Node = {
    type: "claude.worker",
    prompt: "Fix",
    verify: { command: "pnpm test", ...given.verify },
  };
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-verify-"));
  const context: ExecuteContext = {
    runId: "r1",
    id: "fix",
    node,
    workflow: { schemaVersion: 1, name: "t", nodes: { fix: node } },
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
    ...given.over,
  };
  const result = await execute(context);
  return { result, specs, stepNodes, runDir: context.runDir };
};

const PASS = reportOf("pass");

describe("verify:", () => {
  it("accepts a report whose check passes, in one session", async () => {
    const { result, specs, stepNodes } = await runVerified({
      reports: [PASS],
      checks: [PASSED],
    });
    expect(result.ok).toBe(true);
    expect(result.output["verify"]).toEqual({ exitCode: 0, resumes: 0 });
    expect(specs).toHaveLength(1);
    expect(stepNodes).toMatchObject([
      { type: "tool.shell", command: "pnpm test" },
    ]);
  });

  it("sends a failure back to the same session, and checks again", async () => {
    const { result, specs } = await runVerified({
      reports: [PASS, reportOf("pass")],
      checks: [FAILED, PASSED],
    });
    expect(result.ok).toBe(true);
    expect(result.output["verify"]).toEqual({ exitCode: 0, resumes: 1 });
    expect(specs.map(spec => spec.resume)).toEqual([undefined, "s1"]);
    expect(specs[1]?.prompt).toContain("2 tests failed");
    expect(specs[1]?.prompt).toContain("new structured report");
    expect(result.usage?.inputTokens).toBe(2 * USAGE.inputTokens);
  });

  it("fails the node once its attempts are spent", async () => {
    const { result, specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, FAILED],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("its check failed");
    expect(result.error).toContain("2 tests failed");
    expect(result.output["status"]).toBe("fail");
    expect(result.sessionId).toBe("s1");
    expect(specs).toHaveLength(2);
  });

  it("fails at once with no attempts", async () => {
    const { result, specs } = await runVerified({
      reports: [PASS],
      checks: [FAILED],
      verify: { attempts: 0 },
    });
    expect(result.ok).toBe(false);
    expect(specs).toHaveLength(1);
  });

  it("does not resume with none of the budget left", async () => {
    const { result, specs } = await runVerified({
      reports: [PASS],
      checks: [FAILED],
      over: { budgetLeftNow: () => USAGE.costUsd },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("its check failed");
    expect(specs).toHaveLength(1);
  });

  it("gives a resume only what the run has left", async () => {
    const { specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, PASSED],
      over: { budgetLeftNow: () => USAGE.costUsd + 0.25 },
    });
    expect(specs[1]?.budgetUsd).toBeCloseTo(0.25);
  });

  it.each(["fail", "changes_requested"] as const)(
    "does not run on %s, which accepts nothing",
    async status => {
      const { stepNodes, result } = await runVerified({
        reports: [reportOf(status)],
        checks: [],
      });
      expect(stepNodes).toEqual([]);
      expect(result.output["status"]).toBe(status);
    },
  );

  it("runs on done too, so a session can't report its way past it", async () => {
    const { result } = await runVerified({
      reports: [reportOf("done")],
      checks: [FAILED, FAILED],
      verify: { attempts: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("lets a session give up after a failed check", async () => {
    const { result, stepNodes } = await runVerified({
      reports: [PASS, reportOf("fail")],
      checks: [FAILED],
    });
    expect(stepNodes).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("its check failed");
    expect(result.error).toContain("reported fail");
  });

  it("stays failed if a session then reports changes_requested", async () => {
    const { result, stepNodes } = await runVerified({
      reports: [PASS, reportOf("changes_requested")],
      checks: [FAILED],
    });
    expect(stepNodes).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.output["status"]).toBe("fail");
    expect(result.error).toContain("its check failed");
  });

  it("fails a node whose resume gives no report", async () => {
    const { result } = await runVerified({
      reports: [PASS, null],
      checks: [FAILED],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ended without a report");
  });

  it("does not pass a node stopped before its check", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const { result, stepNodes } = await runVerified({
      reports: [PASS],
      checks: [PASSED],
      over: { signal: stopped.signal },
    });
    expect(stepNodes).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("sends the end of a long output, and keeps the rest in a file", async () => {
    const long = `${"x".repeat(20_000)}\nthe last line`;
    const { specs, runDir } = await runVerified({
      reports: [PASS, PASS],
      checks: [
        {
          ok: false,
          output: { exitCode: 1, stdout: long, stderr: "" },
          error: "failed",
        },
        PASSED,
      ],
    });
    const prompt = String(specs[1]?.prompt);
    expect(prompt.length).toBeLessThan(9000);
    expect(prompt).toContain("the last line");
    const file = path.join(runDir, "fix.1.verify.txt");
    expect(prompt).toContain(file);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(long);
  });
});
