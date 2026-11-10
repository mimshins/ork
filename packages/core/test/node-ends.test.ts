/**
 * @file How a node's end reaches what the run records: every `node.finished`
 *   carries one, a transient kind marks the result, a called run's end is
 *   carried up to its caller, feedback is filed by who should act on it, and
 *   any node's detail is scrubbed of the project's and the person's paths.
 */

import { homedir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { createSignals } from "../src/feedback/signals.ts";
import {
  compileWorkflow,
  endedWith,
  endFor,
  type EndKind,
  failedWith,
  type NodeExecutor,
  type RunEvent,
  type RunResult,
  startRun,
} from "../src/index.ts";
import { runEnd } from "../src/remote/call-wait.ts";
import { finishedEvent } from "../src/run/results.ts";

const endOfEvent = (event: RunEvent) =>
  event.type === "node.finished" ? event.end : undefined;

/** The feedback a failed node's end files, as `[kind, target, code]`. */
const filed = (kind: EndKind, detail?: string) => {
  const signals = createSignals();
  return signals(
    finishedEvent("fix", 1, failedWith(endFor(kind, {}, detail))),
  ).flatMap(event =>
    event.type === "feedback.recorded"
      ? [
          {
            kind: event.feedback.kind,
            target: event.feedback.target,
            code: event.feedback.code,
            evidence: event.feedback.evidence,
          },
        ]
      : [],
  );
};

const runResult = (over: Partial<RunResult>): RunResult => ({
  runId: "called01",
  status: "failed",
  costUsd: 0,
  nodes: [],
  reasons: [],
  worktrees: [],
  skipped: 0,
  failuresHandled: 0,
  ...over,
});

describe("a node's end in the run's events", () => {
  it("is on every node.finished: its own, done, or read from older text", () => {
    const ended = failedWith(endFor("turn_limit", { maxTurns: 8 }));
    expect(endOfEvent(finishedEvent("a", 1, ended))).toEqual({
      kind: "turn_limit",
      message: "reached its turn limit (8)",
    });
    expect(
      endOfEvent(finishedEvent("a", 1, { ok: true, output: {} }))?.kind,
    ).toBe("done");
    expect(
      endOfEvent(
        finishedEvent("a", 1, {
          ok: false,
          output: {},
          error: "something no rule knows",
        }),
      ),
    ).toMatchObject({ kind: "unknown", detail: "something no rule knows" });
  });

  it("makes a failure's error its message, and marks a transient kind", () => {
    expect(
      endedWith({ ok: false, output: {} }, endFor("provider_unavailable")),
    ).toMatchObject({
      error: "could not reach its provider, or the provider was overloaded",
      transient: true,
    });
    expect(
      endedWith({ ok: false, output: {} }, endFor("auth")).transient,
    ).toBeUndefined();
    expect(
      endedWith({ ok: true, output: {} }, endFor("done")).error,
    ).toBeUndefined();
  });
});

describe("a called run's end", () => {
  it("is the limit the run stopped at", () => {
    expect(runEnd(runResult({ status: "quota_exhausted" }), "why").kind).toBe(
      "plan_limit",
    );
    expect(runEnd(runResult({ status: "budget_exhausted" }), "why").kind).toBe(
      "budget_limit",
    );
  });

  it("is how its first failed node ended, when it failed", () => {
    const end = endFor("turn_limit", { maxTurns: 3 });
    const nodes = [
      { id: "a", runs: 1, ok: true, output: {}, costUsd: 0 },
      { id: "b", runs: 1, ok: false, output: {}, costUsd: 0, end },
    ];
    expect(runEnd(runResult({ nodes }), "why")).toEqual(end);
    expect(runEnd(runResult({}), "why")).toMatchObject({
      kind: "unknown",
      detail: "why",
    });
  });
});

describe("feedback from a node's end", () => {
  it("files Ork's own end as a bug, with its scrubbed detail", () => {
    expect(filed("unknown", "a stack trace")).toEqual([
      {
        kind: "bug",
        target: "ork",
        code: "end.unknown",
        evidence: ["a stack trace"],
      },
    ]);
  });

  it("files a workflow's end for the workflow, and an agent's as a context gap", () => {
    expect(filed("turn_limit")).toMatchObject([
      { kind: "workflow", target: "workflow" },
    ]);
    expect(filed("invalid_report")).toMatchObject([
      { kind: "context-gap", target: "workflow" },
    ]);
  });

  it("files nothing for an account, a provider, the user, or a node's own no", () => {
    const quiet: EndKind[] = [
      "auth",
      "rate_limited",
      "interrupted",
      "reported_failure",
      "command_failed",
    ];
    expect(quiet.flatMap(kind => filed(kind))).toEqual([]);
  });

  it("files a report the report tool refused as the agent's, not Ork's", () => {
    const signals = createSignals();
    const events: RunEvent[] = [
      {
        type: "node.event",
        id: "fix",
        event: {
          type: "tool.called",
          id: "t1",
          name: "mcp__ork__report",
          input: {},
        },
      },
      {
        type: "node.event",
        id: "fix",
        event: { type: "tool.result", id: "t1", isError: true },
      },
    ];
    const recorded = events
      .flatMap(event => signals(event))
      .filter(event => event.type === "feedback.recorded");
    expect(recorded).toMatchObject([
      {
        feedback: {
          kind: "context-gap",
          target: "workflow",
          code: "report.rejected",
        },
      },
    ]);
  });
});

/** The ends a one-node run of `tool.shell` records, its executor `executor`. */
const shellEnds = async (
  cwd: string,
  executor: NodeExecutor,
): Promise<unknown[]> => {
  const parsed = parseWorkflow(
    'schemaVersion: 1\nname: t\nnodes:\n  sh: { type: tool.shell, command: "make" }',
  );
  if (!parsed.ok) throw new Error("bad workflow");
  const { graph } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error("bad graph");
  const events: RunEvent[] = [];
  await startRun({
    graph,
    inputs: {},
    cwd,
    executors: { "tool.shell": executor },
    human: {
      ask: () => Promise.resolve("none"),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
    },
    runDir: "/nonexistent",
  }).done;
  return events.map(event => endOfEvent(event)).filter(Boolean);
};

describe("a node's detail", () => {
  it("is scrubbed of the project's and the home folder's paths, like a session's", async () => {
    const project = path.join(homedir(), "proj");
    const stderr = `make: cannot read ${project}/Makefile or /Users/someone/x`;
    const ends = await shellEnds(project, () =>
      Promise.resolve(
        failedWith(endFor("command_failed", { program: "make" }, stderr)),
      ),
    );
    expect(ends).toEqual([
      {
        kind: "command_failed",
        message: "make exited with an error",
        detail: "make: cannot read <project>/Makefile or ~/x",
      },
    ]);
  });
});
