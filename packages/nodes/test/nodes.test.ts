/**
 * @file Tests for the built-in node types: tool commands and allow lists, gates
 *   and timeouts, and Claude sessions against a fake runtime.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ClaudeRuntime,
  ExecuteContext,
  HumanChannel,
  Ownership,
  RuntimeEvent,
  SessionOutcome,
  SessionPorts,
  SessionSpec,
} from "@krapht/ork-core";
import { type Node, NodeSchema, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  claudeExecutor,
  gateExecutor,
  isAllowed,
  OUTPUT_LIMIT,
  resultOf,
  timeoutMs,
  tokenize,
  toolExecutor,
  type ToolRunner,
} from "../src/index.ts";

const human = (
  answer: (options: string[]) => Promise<string>,
): HumanChannel => ({
  ask: ({ options }) => answer(options.map(o => o.id)),
  permit: () => Promise.resolve({ allow: true }),
});

const context = (
  id: string,
  node: Node,
  overrides: Partial<ExecuteContext> = {},
): ExecuteContext & { events: RuntimeEvent[] } => {
  const events: RuntimeEvent[] = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-nodes-"));
  const workflow: Workflow = {
    schemaVersion: 1,
    name: "t",
    nodes: { [id]: node },
  };
  return {
    runId: "r1",
    id,
    node,
    workflow,
    inputs: { branch: "feat/x y" },
    outputs: { builder: { branch: "ork/r1/builder" } },
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, ".ork/runs/r1"),
    budgetLeftUsd: undefined,
    human: human(options => Promise.resolve(options[0] ?? "")),
    emit: event => {
      events.push(event);
    },
    signal: new AbortController().signal,
    events,
    ...overrides,
  };
};

const OK_RUN = { exitCode: 0, stdout: "ok", stderr: "" };

const recordingRunner = (run = OK_RUN) => {
  const calls: { program: string; args: readonly string[] }[] = [];
  const runner: ToolRunner = (program, args) => {
    calls.push({ program, args });
    return Promise.resolve(run);
  };
  return { runner, calls };
};

describe("tool commands", () => {
  it("splits like a shell, without one", () => {
    expect(tokenize(`pr merge 'a b' "c \\"d\\"" e\\ f {{ inputs.x }}`)).toEqual(
      {
        ok: true,
        args: ["pr", "merge", "a b", 'c "d"', "e f", "{{ inputs.x }}"],
      },
    );
    expect(tokenize("echo 'open")).toEqual({
      ok: false,
      error: "unclosed ' in command",
    });
  });

  it("checks subcommand prefixes", () => {
    expect(isAllowed(["pr", "merge", "x"], ["pr view", "pr merge"])).toBe(true);
    expect(isAllowed(["repo", "delete", "x"], ["pr merge"])).toBe(false);
    expect(isAllowed(["anything"])).toBe(true);
  });

  it("renders a template inside one argument, so a value never splits", async () => {
    const { runner, calls } = recordingRunner();
    const run = context("merge", {
      type: "tool.gh",
      command:
        "pr merge {{nodes.builder.output.branch}} --title {{inputs.branch}}",
      allow: ["pr merge"],
    });
    const result = await toolExecutor(runner)(run);
    expect(calls).toEqual([
      {
        program: "gh",
        args: ["pr", "merge", "ork/r1/builder", "--title", "feat/x y"],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      output: { exitCode: 0, stdout: "ok", stderr: "" },
    });
    expect(run.events.map(e => e.type)).toEqual(["tool.called", "tool.result"]);
  });

  it("refuses a command outside the allow list before running it", async () => {
    const { runner, calls } = recordingRunner();
    const result = await toolExecutor(runner)(
      context("x", {
        type: "tool.gh",
        command: "repo delete me",
        allow: ["pr view"],
      }),
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      error: '"repo delete me" is not in the node\'s allow list (pr view)',
    });
  });

  it("adds the AWS profile and region, and runs a program for tool.shell", async () => {
    const { runner, calls } = recordingRunner();
    await toolExecutor(runner)(
      context(
        "a",
        NodeSchema.parse({
          type: "tool.aws",
          command: "sts get-caller-identity",
          profile: "dev",
          region: "eu-west-1",
        }),
      ),
    );
    await toolExecutor(runner)(
      context("s", { type: "tool.shell", command: "pnpm test" }),
    );
    expect(calls).toEqual([
      {
        program: "aws",
        args: [
          "sts",
          "get-caller-identity",
          "--profile",
          "dev",
          "--region",
          "eu-west-1",
        ],
      },
      { program: "pnpm", args: ["test"] },
    ]);
  });

  it("fails on a non-zero exit and keeps long output in a file", async () => {
    const long = "x".repeat(OUTPUT_LIMIT + 10);
    const { runner } = recordingRunner({
      exitCode: 2,
      stdout: long,
      stderr: "boom\n",
    });
    const run = context("t", { type: "tool.shell", command: "make" });
    const result = await toolExecutor(runner)(run);
    const file = path.join(run.cwd, ".ork/runs/r1/t.1.stdout.txt");
    expect(result).toMatchObject({
      ok: false,
      error: "make exited with 2: boom",
    });
    expect(String(result.output["stdout"])).toContain(
      `(truncated; the full output is in ${file})`,
    );
    expect(readFileSync(file, "utf8")).toBe(long);
    expect(existsSync(path.join(run.cwd, ".ork/runs/r1/t.1.stderr.txt"))).toBe(
      false,
    );
  });
});

describe("human gates", () => {
  const gate: Node = {
    type: "human.gate",
    question: "Merge {{nodes.builder.output.branch}}?",
    options: ["merge", { id: "reject", label: "No" }],
    recommended: "reject",
  };

  it("asks the rendered question and outputs the choice", async () => {
    const asked: string[] = [];
    const channel: HumanChannel = {
      ask: ({ question, options, recommended }) => {
        asked.push(
          `${question} ${options.map(o => o.id).join("/")} ${String(recommended)}`,
        );
        return Promise.resolve("merge");
      },
      permit: () => Promise.resolve({ allow: true }),
    };
    const result = await gateExecutor(context("g", gate, { human: channel }));
    expect(asked).toEqual(["Merge ork/r1/builder? merge/reject reject"]);
    expect(result).toEqual({
      ok: true,
      output: { choice: "merge", answeredBy: "user" },
    });
  });

  it("answers with the default when the timeout passes", async () => {
    let withdrawn = false;
    const silent: HumanChannel = {
      ask: ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            withdrawn = true;
            reject(new Error("withdrawn"));
          });
        }),
      permit: () => Promise.resolve({ allow: true }),
    };
    const timed: Node = { ...gate, timeout: "0s", default: "reject" };
    const result = await gateExecutor(context("g", timed, { human: silent }));
    expect(result).toEqual({
      ok: true,
      output: { choice: "reject", answeredBy: "timeout" },
    });
    expect(withdrawn).toBe(true);
    expect(timeoutMs("15m")).toBe(900_000);
  });
});

const usage = {
  costUsd: 0.5,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};
const outcome = (report: SessionOutcome["report"]): SessionOutcome => ({
  subtype: report === null ? "error_max_turns" : "success",
  sessionId: "s",
  report,
  text: "",
  usage,
  errors: report === null ? ["out of turns"] : [],
});

const finishedPassing = async function* (): AsyncGenerator<RuntimeEvent> {
  await Promise.resolve();
  yield {
    type: "session.finished",
    outcome: outcome({
      status: "pass",
      summary: "ok",
      artifacts: {},
      fields: {},
    }),
  };
};

describe("Claude nodes", () => {
  it("turns a report into the node's output", () => {
    expect(
      resultOf(
        outcome({
          status: "pass",
          summary: "done",
          artifacts: {},
          branch: "b",
          fields: { verdict: "approve" },
        }),
      ),
    ).toEqual({
      ok: true,
      output: {
        verdict: "approve",
        status: "pass",
        summary: "done",
        artifacts: {},
        branch: "b",
        usage,
      },
      usage,
      sessionId: "s",
    });
    expect(resultOf(outcome(null))).toMatchObject({
      ok: false,
      output: { status: "fail" },
      error: "ended without a report (error_max_turns): out of turns",
    });
  });

  it("runs a session with the run's outputs, its budget, and the re-entry input", async () => {
    const specs: SessionSpec[] = [];
    const runtime: ClaudeRuntime = {
      driver: "sdk",
      start: spec => {
        specs.push(spec);
        return {
          events: finishedPassing(),
          send: () => {},
          interrupt: () => Promise.resolve(),
        };
      },
    };
    const drivers: string[] = [];
    const execute = claudeExecutor({
      runtimeFor: driver => {
        drivers.push(driver);
        return Promise.resolve(runtime);
      },
      driver: "cli",
      inPlace: true,
    });
    const node: Node = {
      type: "claude.worker",
      prompt: "Fix {{nodes.builder.output.branch}}",
      budgetUsd: 3,
    };
    const result = await execute(
      context("fix", node, {
        round: 2,
        input: { statuses: ["changes_requested"] },
        budgetLeftUsd: 1,
      }),
    );
    expect(result.ok).toBe(true);
    expect(drivers).toEqual(["cli"]);
    expect(specs[0]?.budgetUsd).toBe(1);
    expect(specs[0]?.prompt).toContain("Fix ork/r1/builder\n\n## Round 2");
    expect(specs[0]?.prompt).toContain('"changes_requested"');
  });

  it("gives a leader its children, and resumes it with only the new task", async () => {
    const started: { spec: SessionSpec; ports: SessionPorts }[] = [];
    const runtime: ClaudeRuntime = {
      driver: "sdk",
      start: (spec, ports) => {
        started.push({ spec, ports });
        return {
          events: finishedPassing(),
          send: () => {},
          interrupt: () => Promise.resolve(),
        };
      },
    };
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      inPlace: true,
    });
    const ownership: Ownership = {
      children: [{ id: "fix", type: "claude.worker", description: "fixes" }],
      templates: ["fix"],
      workersLeft: () => 2,
      delegate: () => Promise.resolve({ reports: [], notes: [] }),
      spawn: () => Promise.resolve({ reports: [], notes: [] }),
    };
    const lead: Node = {
      type: "claude.leader",
      prompt: "Ship {{inputs.branch}}",
    };
    const first = await execute(context("lead", lead, { ownership }));
    const again = await execute(
      context("lead", lead, {
        ownership,
        round: 2,
        resume: "s1",
        brief: { from: "boss", text: "Now add tests" },
      }),
    );
    expect(first.sessionId).toBe("s");
    expect(again.ok).toBe(true);
    const [one, two] = started;
    expect(one?.ports.ownership).toBe(ownership);
    expect(one?.spec.resume).toBeUndefined();
    expect(one?.spec.systemAppend).toContain("You own `fix` (fixes)");
    expect(one?.spec.systemAppend).toContain("(2 left)");
    expect(two?.spec.resume).toBe("s1");
    expect(two?.spec.prompt).toBe(
      "## New task from `boss`\n\nNow add tests\n\nEnd with a new structured report.",
    );
  });

  it("puts a delegated brief after the node's own prompt", async () => {
    const specs: SessionSpec[] = [];
    const execute = claudeExecutor({
      runtimeFor: () =>
        Promise.resolve({
          driver: "sdk",
          start: spec => {
            specs.push(spec);
            return {
              events: finishedPassing(),
              send: () => {},
              interrupt: () => Promise.resolve(),
            };
          },
        }),
      inPlace: true,
    });
    const node: Node = { type: "claude.worker", prompt: "You fix bugs." };
    await execute(
      context("fix-2", node, {
        template: "fix",
        brief: { from: "lead", text: "Fix the login bug" },
        workflow: { schemaVersion: 1, name: "t", nodes: { fix: node } },
      }),
    );
    expect(specs[0]?.prompt).toBe(
      "You fix bugs.\n\n## Task from `lead`\n\nFix the login bug",
    );
    expect(specs[0]?.systemAppend).toContain(
      "You are the `fix-2` node (claude.worker, an instance of `fix`)",
    );
  });
});
