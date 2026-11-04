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
  Mailbox,
  NodeExecutor,
  NodeReport,
  NodeResult,
  RunLimits,
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import type { Node, Verify } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/claude.ts";
import { spawnTool, toolExecutor } from "../src/index.ts";

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
  fields?: Partial<Extract<Node, { type: "claude.worker" }>>;
  /** The whole check, for one that isn't the default command. */
  program?: Verify;
  steps?: NodeExecutor;
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
    steps:
      given.steps ??
      (context => {
        stepNodes.push(context.node);
        return Promise.resolve(
          given.checks[stepNodes.length - 1] ?? {
            ok: false,
            output: {},
            error: "no more checks",
          },
        );
      }),
  });
  const node: Node = {
    type: "claude.worker",
    prompt: "Fix",
    verify: given.program ?? { command: "pnpm test", ...given.verify },
    ...given.fields,
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

const mailOnce = (arrives: () => boolean): Mailbox => ({
  peers: () => [],
  send: () => ({ ok: false, error: "no" }),
  read: () => [],
  pending: () => (arrives() ? 1 : 0),
  alias: () => {},
  linkable: () => false,
  hears: () => false,
  wait: () => Promise.resolve(),
  answer: () => ({ ok: true }),
  connect: () => () => {},
});

/** One unread message, once, after a first check; none before or after. */
const mailAfterFirst = (checks: () => number): Mailbox => {
  let told = false;
  return mailOnce(() => {
    const now = checks() === 1 && !told;
    told = told || now;
    return now;
  });
};

/** $10 of a quota left, and $9.50 once the ledger has the first session. */
const quotaAfterSession = () => {
  let looks = 0;
  return (): RunLimits => {
    looks += 1;
    return { leftUsd: looks > 2 ? 9.5 : 10 };
  };
};

/** Nothing is limited on the first look or the second; then a limit holds. */
const blockedAfterFirst = () => {
  let looks = 0;
  return (): RunLimits => {
    looks += 1;
    return looks > 2 ? { blocked: "a limit" } : {};
  };
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

  const realSteps = toolExecutor(spawnTool, { environ: {} });

  it("sends the real end of an output too long to keep in an event", async () => {
    const { specs, runDir, result } = await runVerified({
      reports: [PASS, reportOf("fail")],
      checks: [],
      steps: realSteps,
      program: {
        script:
          'i=0; while [ $i -lt 20000 ]; do echo "passing test $i"; i=$((i+1)); done; echo "3 tests failed at the end"; exit 1',
      },
    });
    const prompt = String(specs[1]?.prompt);
    expect(prompt.length).toBeLessThan(9000);
    expect(prompt).toContain("3 tests failed at the end");
    expect(prompt).not.toContain("truncated");
    expect(
      readFileSync(path.join(runDir, "fix.1.verify.txt"), "utf8"),
    ).toContain("3 tests failed at the end");
    expect(String(result.error).length).toBeLessThan(2000);
  });

  it("does not send a session a huge line as its reason", async () => {
    const { specs, result } = await runVerified({
      reports: [PASS, reportOf("fail")],
      checks: [],
      steps: realSteps,
      program: {
        interpreter: "node",
        script:
          'process.stderr.write("x".repeat(200000) + "\\n"); process.exit(1)',
      },
    });
    expect(String(specs[1]?.prompt).length).toBeLessThan(10_000);
    expect(String(result.error).length).toBeLessThan(2000);
  });

  it("counts turns across its resumes", async () => {
    const { specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, PASSED],
      fields: { maxTurns: 10 },
    });
    expect(specs.map(spec => spec.maxTurns)).toEqual([10, 9]);
  });

  it("fails rather than resuming with no turns left", async () => {
    const { specs, result } = await runVerified({
      reports: [PASS],
      checks: [FAILED],
      fields: { maxTurns: 1 },
    });
    expect(specs).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("gives a re-entered session what the run has left, not less", async () => {
    const { specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, PASSED],
      over: { ownSpend: () => 0.1, budgetLeftNow: () => 1 },
    });
    expect(specs[1]?.budgetUsd).toBeCloseTo(0.9);
  });

  it("reads a message that came during a check that passed, and checks again", async () => {
    let checks = 0;
    const { result, specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [],
      steps: () => {
        checks += 1;
        return Promise.resolve(PASSED);
      },
      over: {
        mailbox: mailAfterFirst(() => checks),
      },
    });
    expect(specs).toHaveLength(2);
    expect(String(specs[1]?.prompt)).toContain("message");
    expect(checks).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("takes one late turn after a pass, however many messages come", async () => {
    let checks = 0;
    const { result, specs } = await runVerified({
      reports: [PASS, PASS, PASS],
      checks: [],
      steps: () => {
        checks += 1;
        return Promise.resolve(PASSED);
      },
      over: { mailbox: mailOnce(() => checks >= 1) },
    });
    expect(specs).toHaveLength(2);
    expect(checks).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("does not count a finished session against a quota twice", async () => {
    const { specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, PASSED],
      over: { quota: quotaAfterSession() },
    });
    expect(specs[1]?.budgetUsd).toBeCloseTo(9.5);
  });

  it("says a limit ended a node when no retry could start", async () => {
    const { specs, result } = await runVerified({
      reports: [PASS],
      checks: [FAILED],
      over: { quota: blockedAfterFirst() },
    });
    expect(specs).toHaveLength(1);
    expect(result.limited).toBe("a limit");
  });

  it("does not start a session once a limit is spent", async () => {
    const { specs, result } = await runVerified({
      reports: [PASS],
      checks: [PASSED],
      over: { quota: () => ({ blocked: "a limit" }) },
    });
    expect(specs).toEqual([]);
    expect(result).toMatchObject({ ok: false, limited: "a limit" });
  });

  it("does not start with nothing left of the budget", async () => {
    const { specs, result } = await runVerified({
      reports: [PASS],
      checks: [PASSED],
      over: { budgetLeftNow: () => -2 },
    });
    expect(specs).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("does not resume while the node is paused until it continues", async () => {
    const waits: string[] = [];
    const { specs } = await runVerified({
      reports: [PASS, PASS],
      checks: [FAILED, PASSED],
      over: {
        hold: {
          held: () => false,
          wait: at => {
            waits.push(at);
            return Promise.resolve();
          },
          watch: () => () => {},
        },
      },
    });
    expect(specs).toHaveLength(2);
    expect(waits).toEqual(["start"]);
  });
});
