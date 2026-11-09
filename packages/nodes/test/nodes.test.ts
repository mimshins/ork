/**
 * @file Tests for the built-in node types: tool commands and allow lists, gates
 *   and timeouts, and Claude sessions against a fake runtime.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  type CallPort,
  type CallRequest,
  type ClaudeRuntime,
  createHolds,
  type ExecuteContext,
  type HumanChannel,
  type Mailbox,
  type NodeResult,
  type Ownership,
  type RuntimeEvent,
  type SessionOutcome,
  type SessionPorts,
  type SessionSpec,
} from "@krapht/ork-core";
import {
  type Node,
  NodeSchema,
  parseWorkflow,
  serializeWorkflow,
  type Workflow,
  timeoutMs,
} from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  callExecutor,
  claudeExecutor,
  gateExecutor,
  isAllowed,
  OUTPUT_LIMIT,
  resultOf,
  resumeMessage,
  spawnTool,
  tokenize,
  toolExecutor,
  type ToolRunner,
} from "../src/index.ts";
import {
  afterLateTurn,
  lateLimits,
  withUsageOf,
} from "../src/session-turns.ts";

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
    workflowDir: cwd,
    projectRoot: cwd,
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
      error: "`repo delete me` is not in the node's allow list (`pr view`)",
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

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

describe("git nodes", () => {
  it("add and commit by default, and push only when allowed", async () => {
    const { runner, calls } = recordingRunner();
    const push = await toolExecutor(runner)(
      context("ship", { type: "tool.git", command: "push origin main" }),
    );
    expect(calls).toEqual([]);
    expect(push).toMatchObject({
      ok: false,
      error:
        "`push origin main` is not in the node's allow list (`add`, `commit`)",
    });
    const allowed = await toolExecutor(runner)(
      context("ship", {
        type: "tool.git",
        command: "push origin main",
        allow: ["push"],
      }),
    );
    expect(allowed.ok).toBe(true);
    expect(calls[0]).toEqual({
      program: "git",
      args: ["push", "origin", "main"],
    });
  });

  it("output the staged changes, for a gate, and the commit after", async () => {
    const run = context("stage", { type: "tool.git", command: "add -A" });
    gitIn(run.cwd, "init", "--quiet");
    gitIn(run.cwd, "config", "user.name", "Test");
    gitIn(run.cwd, "config", "user.email", "test@example.com");
    gitIn(run.cwd, "config", "commit.gpgsign", "false");
    writeFileSync(path.join(run.cwd, "hello.txt"), "hello\n");
    const staged = await toolExecutor(spawnTool)(run);
    expect(staged.output).toMatchObject({ exitCode: 0, head: "" });
    expect(String(staged.output["staged"])).toContain("hello.txt");
    expect(String(staged.output["diff"])).toContain("+hello");

    const commit = await toolExecutor(spawnTool)(
      context(
        "commit",
        { type: "tool.git", command: "commit -m {{inputs.branch}}" },
        { cwd: run.cwd },
      ),
    );
    expect(commit.output).toMatchObject({ exitCode: 0, staged: "", diff: "" });
    expect(commit.output["head"]).toBe(
      gitIn(run.cwd, "rev-parse", "HEAD").trim(),
    );
    expect(gitIn(run.cwd, "log", "--format=%s")).toBe("feat/x y\n");
  });
});

/** One of this repository's own workflows, as written and as parsed. */
const ownWorkflow = (name: string) => {
  const text = readFileSync(
    new URL(`../../../.ork/workflows/${name}.ork.yaml`, import.meta.url),
    "utf8",
  );
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return { text, workflow: parsed.workflow };
};

/** What people at gate `id` of workflow `name` would read, from a fixture. */
const ownGateText = async (name: string, id: string) => {
  const node = ownWorkflow(name).workflow.nodes[id];
  if (node === undefined) throw new Error(`No node ${id}.`);
  const seen: { question?: string; document?: string | undefined } = {};
  await gateExecutor(
    context(id, node, {
      human: {
        ask: ({ question, document }) => {
          seen.question = question;
          seen.document = document;
          return Promise.resolve("stop");
        },
        permit: () => Promise.resolve({ allow: true }),
      },
      outputs: {
        frame: { recommendation: "plan", analysis: "No open decisions." },
        spec: { plan: "# The plan\n\nThe whole of it.", summary: "None." },
        build: {
          summary: "Built it.",
          unchecked: "A real browser.",
          decisions: [
            {
              what: "Use X",
              why: "Y",
              decidedBy: "implement",
              hardToReverse: true,
            },
          ],
        },
        review: {
          status: "pass",
          summary: "Looks right.",
          findings: "One nit left.",
          unchecked: "",
        },
        docs: {
          summary: "Specs synced.",
          worktree: "/tmp/w",
          adrs: [{ title: "ADR-1", path: "decisions/ADR-1.md" }],
          commitSubject: "Add the thing",
          commitBody: "Because it was needed.",
        },
        stage: { staged: " a.ts | 2 +-\n b.ts | 1 +" },
      },
    }),
  );
  return { question: seen.question ?? "", document: seen.document ?? "" };
};

describe("this repository's own workflows", () => {
  it.each(["feature", "rfc", "plan", "build", "qa-pass"])(
    "keeps %s in canonical form",
    name => {
      const { text, workflow } = ownWorkflow(name);
      expect(serializeWorkflow(workflow)).toBe(text);
    },
  );

  it.each([
    ["feature", "route"],
    ["plan", "approve"],
    ["build", "ratify"],
    ["build", "decide"],
  ])("shows no raw JSON at %s's %s", async (name, id) => {
    const { question, document } = await ownGateText(name, id);
    expect(`${question}\n${document}`).not.toMatch(/\{"|\[\{/u);
  });

  it("keeps the plan out of approve's question, in its document", async () => {
    const { question, document } = await ownGateText("plan", "approve");
    expect(question).not.toContain("The whole of it.");
    expect(question).toContain("revise");
    expect(document).toBe("# The plan\n\nThe whole of it.");
  });

  it("gives decide a short question and a sectioned document", async () => {
    const { question, document } = await ownGateText("build", "decide");
    expect(question.startsWith("Where does this change go?")).toBe(true);
    expect(question).not.toContain("Add the thing");
    expect(document.match(/^## .+$/gmu)).toEqual([
      "## What was built",
      "## Review",
      "## What wasn't checked",
      "## ADRs",
      "## Commit message",
      "## Files changed",
    ]);
    expect(document).toContain("- title: ADR-1\n  path: decisions/ADR-1.md");
    expect(document).toContain("Verdict: pass");
    expect(document).toContain("Build: A real browser.");
  });

  it("keeps decide's choices", () => {
    expect(ownWorkflow("build").workflow.nodes["decide"]).toMatchObject({
      options: ["main", "branch", "keep-uncommitted", "discard"],
    });
  });
});

describe("this repository's ratify gate", () => {
  it("shows who made each decision", async () => {
    const { document } = await ownGateText("build", "ratify");
    expect(document).toContain("decidedBy: implement");
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
      output: { choice: "merge", answeredBy: "user", note: "" },
    });
  });

  it("renders the question and document readably, and passes the document", async () => {
    const seen: { question: string; document?: string | undefined }[] = [];
    const channel: HumanChannel = {
      ask: ({ question, document }) => {
        seen.push({ question, document });
        return Promise.resolve("merge");
      },
      permit: () => Promise.resolve({ allow: true }),
    };
    await gateExecutor(
      context(
        "g",
        {
          ...gate,
          question: "Files:\n{{nodes.a.output.files}}",
          document: "{{nodes.a.output.notes}}",
        },
        {
          human: channel,
          outputs: {
            a: {
              files: ["x", "y"],
              notes: [{ file: "x", why: "new" }],
            },
          },
        },
      ),
    );
    expect(seen).toEqual([
      {
        question: "Files:\n- x\n- y",
        document: "- file: x\n  why: new",
      },
    ]);
  });

  it.each([
    ["none", {}],
    ["one that renders empty", { document: " {{nodes.a.output.gone}}\n" }],
  ])("has no document with %s", async (_name, extra) => {
    const documents: (string | undefined)[] = [];
    const channel: HumanChannel = {
      ask: ({ document }) => {
        documents.push(document);
        return Promise.resolve("merge");
      },
      permit: () => Promise.resolve({ allow: true }),
    };
    await gateExecutor(context("g", { ...gate, ...extra }, { human: channel }));
    expect(documents).toEqual([undefined]);
  });

  it("outputs the note given with the answer, for a later node's template", async () => {
    const noted: HumanChannel = {
      ask: ({ onNote }) => {
        onNote?.("Cut the API section");
        return Promise.resolve("reject");
      },
      permit: () => Promise.resolve({ allow: true }),
    };
    const answered = await gateExecutor(
      context("approve", gate, { human: noted }),
    );
    expect(answered).toEqual({
      ok: true,
      output: {
        choice: "reject",
        answeredBy: "user",
        note: "Cut the API section",
      },
    });

    const { runner, calls } = recordingRunner();
    const next = context(
      "tell",
      {
        type: "tool.gh",
        command: "issue comment 1 --body {{nodes.approve.output.note}}",
        allow: ["issue comment"],
      },
      { outputs: { approve: answered.output } },
    );
    await toolExecutor(runner)(next);
    expect(calls).toEqual([
      {
        program: "gh",
        args: ["issue", "comment", "1", "--body", "Cut the API section"],
      },
    ]);
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
      output: { choice: "reject", answeredBy: "timeout", note: "" },
    });
    expect(withdrawn).toBe(true);
    expect(timeoutMs("15m")).toBe(900_000);
  });

  it("keeps its time while the run is paused, and answers once it continues", async () => {
    const silent: HumanChannel = {
      ask: ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new Error("withdrawn"));
          });
        }),
      permit: () => Promise.resolve({ allow: true }),
    };
    const holds = createHolds({
      onEvent: () => {
        // Not under test.
      },
      onChange: () => {
        // Not under test.
      },
    });
    holds.pause();
    const timed: Node = { ...gate, timeout: "0s", default: "reject" };
    let answered = false;
    const result = gateExecutor(
      context("g", timed, { human: silent, hold: holds.forNode("g") }),
    ).then(value => {
      answered = true;
      return value;
    });
    await sleep(100);
    expect(answered).toBe(false);
    holds.proceed();
    expect(await result).toEqual({
      ok: true,
      output: { choice: "reject", answeredBy: "timeout", note: "" },
    });
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

/** A mailbox that only says how many messages are unread. */
const mailboxWith = (pending: () => number): Mailbox => ({
  peers: () => [],
  send: () => ({ ok: false, error: "no" }),
  read: () => [],
  pending,
  alias: () => {},
  linkable: () => false,
  hears: () => false,
  wait: () => Promise.resolve(),
  answer: () => ({ ok: true }),
  connect: () => () => {},
});

/** One unread message after the first session, none after the second. */
const unreadAfter = (sessions: number): number => Number(sessions === 1);

const capOf = (cap: number | undefined): { budgetUsd?: number } =>
  cap === undefined ? {} : { budgetUsd: cap };

/** A Claude executor with `options`, and the drivers it started. */
const executing = (options: { driver?: "cli"; readyDriver?: "sdk" }) => {
  const drivers: string[] = [];
  const execute = claudeExecutor({
    runtimeFor: driver => {
      drivers.push(driver);
      return Promise.resolve({
        driver,
        start: () => ({
          events: finishedPassing(),
          send: () => {},
          interrupt: () => Promise.resolve(),
        }),
      });
    },
    inPlace: true,
    ...options,
  });
  return { execute, drivers };
};

/** Each session's `machineClaude`, from an executor with `machine`. */
const machineOfSpecs = async (machine: { machineClaude?: boolean }) => {
  const specs: SessionSpec[] = [];
  const execute = claudeExecutor({
    runtimeFor: driver =>
      Promise.resolve({
        driver,
        start: spec => {
          specs.push(spec);
          return {
            events: finishedPassing(),
            send: () => {},
            interrupt: () => Promise.resolve(),
          };
        },
      }),
    readyDriver: "sdk",
    inPlace: true,
    ...machine,
  });
  await execute(context("fix", { type: "claude.worker", prompt: "Fix" }));
  return specs.map(spec => spec.machineClaude);
};

/** The specs an executor started for `node` in a project with `file`. */
const specsWithMcp = async (node: Node, file: string | undefined) => {
  const specs: SessionSpec[] = [];
  const execute = claudeExecutor({
    runtimeFor: driver =>
      Promise.resolve({
        driver,
        start: spec => {
          specs.push(spec);
          return {
            events: finishedPassing(),
            send: () => {},
            interrupt: () => Promise.resolve(),
          };
        },
      }),
    readyDriver: "sdk",
    inPlace: true,
  });
  const ctx = context("design", node);
  writeMcpFile(ctx.projectRoot, file);
  const result = await execute(ctx);
  return { specs, result, events: ctx.events };
};

const writeMcpFile = (root: string, file: string | undefined): void => {
  if (file !== undefined) writeFileSync(path.join(root, ".mcp.json"), file);
};

describe("a Claude node's MCP servers", () => {
  const entry = { command: "npx", env: { TOKEN: "${SECRET_TOKEN}" } };
  const file = JSON.stringify({ mcpServers: { browser: entry, other: {} } });

  it("are the named entries, as written, and none of the file's others", async () => {
    const { specs } = await specsWithMcp(
      { type: "claude.worker", prompt: "Go", mcp: ["browser"] },
      file,
    );
    expect(specs[0]?.mcpServers).toEqual({ browser: entry });
  });

  it("are unset for a node that names none", async () => {
    const { specs } = await specsWithMcp(
      { type: "claude.worker", prompt: "Go" },
      file,
    );
    expect(specs[0]?.mcpServers).toBeUndefined();
  });

  it("keep their definitions out of the events", async () => {
    const { events } = await specsWithMcp(
      { type: "claude.worker", prompt: "Go", mcp: ["browser"] },
      file,
    );
    expect(JSON.stringify(events)).not.toContain("SECRET_TOKEN");
  });

  it("fail the node when the file lost the server after the checks", async () => {
    const { result, specs } = await specsWithMcp(
      { type: "claude.worker", prompt: "Go", mcp: ["gone"] },
      file,
    );
    expect(result).toMatchObject({
      ok: false,
      error: "not started: no MCP server `gone` in .mcp.json",
    });
    expect(specs).toEqual([]);
  });
});

describe("Claude nodes", () => {
  it("keeps the session when a late turn never started one", () => {
    const first = outcome(null);
    const merged = withUsageOf(
      {
        ...first,
        sessionId: "s1",
        usage: { ...first.usage, costUsd: 5 },
      },
      { ...first, sessionId: "", usage: { ...first.usage, costUsd: 0 } },
    );
    expect(merged.sessionId).toBe("s1");
    expect(merged.usage.costUsd).toBe(5);
  });

  it("tells a session cut off by the run to carry on, and a re-entered one its round", () => {
    expect(resumeMessage(1, null)).toContain("Ork was stopped");
    expect(resumeMessage(2, { statuses: [] })).toContain("## Round 2");
    expect(
      resumeMessage(1, undefined, { from: "lead", text: "Fix it." }),
    ).toContain("## New task from `lead`");
  });

  it("reads a message that came in as it finished, in one more turn", async () => {
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
    const execute = claudeExecutor({
      runtimeFor: () => Promise.resolve(runtime),
      readyDriver: "sdk",
      inPlace: true,
    });
    const node: Node = { type: "claude.worker", prompt: "Fix" };

    // One message is unread when the first session ends, none after.
    const late = mailboxWith(() => unreadAfter(specs.length));
    const result = await execute(context("fix", node, { mailbox: late }));
    expect(specs.map(s => s.resume)).toEqual([undefined, "s"]);
    expect(specs[1]?.prompt).toContain("1 message came in while you finished");
    // Cost is already the session's total; tokens are each process's own.
    expect(result.usage?.costUsd).toBe(usage.costUsd);
    expect(result.usage?.inputTokens).toBe(2 * usage.inputTokens);

    specs.length = 0;
    await execute(context("fix", node, { mailbox: mailboxWith(() => 0) }));
    expect(specs).toHaveLength(1);
  });

  it("starts its sessions with the machine's Claude setup only when the run asks", async () => {
    expect(await machineOfSpecs({})).toEqual([undefined]);
    expect(await machineOfSpecs({ machineClaude: true })).toEqual([true]);
  });

  describe("a late turn", () => {
    const PASSED = {
      status: "pass",
      summary: "ok",
      artifacts: {},
      fields: {},
    } as const;

    const lateRun = async (overrides: Partial<ExecuteContext>) => {
      const specs: SessionSpec[] = [];
      const runtime: ClaudeRuntime = {
        driver: "sdk",
        start: spec => {
          specs.push(spec);
          const report = specs.length === 1 ? PASSED : null;
          return {
            events: (async function* () {
              await Promise.resolve();
              yield {
                type: "session.finished" as const,
                outcome: outcome(report),
              };
            })(),
            send: () => {},
            interrupt: () => Promise.resolve(),
          };
        },
      };
      const execute = claudeExecutor({
        runtimeFor: () => Promise.resolve(runtime),
        readyDriver: "sdk",
        inPlace: true,
      });
      const node: Node = { type: "claude.worker", prompt: "Fix" };
      const mailbox = mailboxWith(() => unreadAfter(specs.length));
      const result = await execute(
        context("fix", node, { mailbox, ...overrides }),
      );
      return { specs, result };
    };

    it("does not fail a node that passed when it gives no report", async () => {
      const { specs, result } = await lateRun({});
      expect(specs).toHaveLength(2);
      expect(result.ok).toBe(true);
      expect(result.output["summary"]).toBe("ok");
      expect(result.usage?.inputTokens).toBe(2 * usage.inputTokens);
    });

    it("does not start with none of the run's budget left", async () => {
      const { specs, result } = await lateRun({
        budgetLeftNow: () => usage.costUsd,
      });
      expect(specs).toHaveLength(1);
      expect(result.ok).toBe(true);
    });

    it("gets only what the run has left", async () => {
      const { specs } = await lateRun({
        budgetLeftNow: () => usage.costUsd + 0.25,
      });
      expect(specs[1]?.budgetUsd).toBeCloseTo(0.25);
    });

    it.each([
      ["no budget at all", undefined, undefined, 1, {}],
      ["the node's cap", 3, undefined, 1, { budgetUsd: 2 }],
      ["the run's, when lower", 3, 1.5, 1, { budgetUsd: 0.5 }],
      ["nothing left of the cap", 1, undefined, 1, null],
      ["nothing left of the run's", 3, 1, 1, null],
    ])("spends within %s", (_name, cap, runLeft, spent, expected) => {
      expect(lateLimits(capOf(cap), { spent, turns: 0 }, runLeft)).toEqual(
        expected,
      );
    });

    it("takes a quota's left as it is: the ledger has this session", () => {
      expect(
        lateLimits({ budgetUsd: 10 }, { spent: 6, turns: 0 }, undefined, 4),
      ).toEqual({ budgetUsd: 4 });
      expect(lateLimits({}, { spent: 6, turns: 0 }, undefined, 0)).toBeNull();
    });

    it("has only the turns its node has left", () => {
      const spec = { maxTurns: 10 };
      expect(lateLimits(spec, { spent: 0, turns: 4 })).toEqual({
        maxTurns: 6,
      });
      expect(lateLimits(spec, { spent: 0, turns: 10 })).toBeNull();
    });

    it("keeps a later report when it gives one", () => {
      const first = outcome(PASSED);
      const later = outcome({ ...PASSED, summary: "read it" });
      expect(afterLateTurn(first, later).report?.summary).toBe("read it");
    });
  });

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

  it("fails a report whose field isn't what the node declared", () => {
    const fields = { verdict: "maybe" };
    const report = { status: "pass", summary: "s", artifacts: {} } as const;
    const declared = { verdict: ["approve", "escalate"] };
    expect(
      resultOf(outcome({ ...report, fields: { verdict: "approve" } }), declared)
        .ok,
    ).toBe(true);
    expect(resultOf(outcome({ ...report, fields }), declared)).toMatchObject({
      ok: false,
      output: {
        status: "fail",
        summary: "verdict is `maybe`, expected `approve` or `escalate`",
      },
      error: "verdict is `maybe`, expected `approve` or `escalate`",
      sessionId: "s",
    });
    // What it didn't declare isn't its output, so no condition can read it.
    expect(
      resultOf(outcome({ ...report, fields }), declared).output,
    ).not.toHaveProperty("verdict");
    // What every report has stays.
    expect(
      resultOf(
        outcome({
          ...report,
          artifacts: { log: "l.txt" },
          branch: "b",
          fields,
        }),
        declared,
      ).output,
    ).toMatchObject({ artifacts: { log: "l.txt" }, branch: "b" });
    // A node's own list for `status` narrows it; the value is on the report.
    expect(
      resultOf(outcome({ ...report, fields }), { status: ["pass"] }).ok,
    ).toBe(true);
  });

  it("reads an item in a Claude node's prompt", async () => {
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
    const node: Node = { type: "claude.worker", prompt: "Do {{item.title}}" };
    await execute(
      context("build.1", node, {
        template: "build",
        workflow: { schemaVersion: 1, name: "t", nodes: { build: node } },
        item: { of: "build", index: 1, value: { title: "docs" } },
      }),
    );
    expect(specs[0]?.prompt).toContain("Do docs");
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
      effort: "high",
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
    expect(specs[0]?.effort).toBe("high");
    expect(specs[0]?.prompt).toContain("Fix ork/r1/builder\n\n## Round 2");
    expect(specs[0]?.prompt).toContain('"changes_requested"');
  });

  describe("the driver", () => {
    it("is the node's own, over the one ready", async () => {
      const { execute, drivers } = executing({ readyDriver: "sdk" });
      const node: Node = { type: "claude.worker", prompt: "x", driver: "cli" };
      await execute(context("fix", node));
      expect(drivers).toEqual(["cli"]);
    });

    it("is the one ready, when nothing names one", async () => {
      const { execute, drivers } = executing({ readyDriver: "sdk" });
      await execute(context("fix", { type: "claude.worker", prompt: "x" }));
      expect(drivers).toEqual(["sdk"]);
    });

    it("leaves the node not started when there is none", async () => {
      const { execute, drivers } = executing({});
      const result = await execute(
        context("fix", { type: "claude.worker", prompt: "x" }),
      );
      expect(drivers).toEqual([]);
      expect(result.error).toBe(
        "not started: no Claude driver is ready; see `ork doctor`",
      );
    });
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
      readyDriver: "sdk",
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
      readyDriver: "sdk",
      inPlace: true,
    });
    const node: Node = { type: "claude.worker", prompt: "You fix bugs." };
    await execute(
      context("fix-2", node, {
        template: "fix",
        brief: { from: "lead", text: "Fix the login bug" },
        workflow: {
          schemaVersion: 1,
          name: "t",
          defaults: { effort: "max" },
          nodes: { fix: node },
        },
      }),
    );
    expect(specs[0]?.prompt).toBe(
      "You fix bugs.\n\n## Task from `lead`\n\nFix the login bug",
    );
    expect(specs[0]?.systemAppend).toContain(
      "You are the `fix-2` node (claude.worker, an instance of `fix`)",
    );
    // An instance takes its template's settings, then the defaults.
    expect(specs[0]?.effort).toBe("max");
  });
});

/** A call port that writes down what it was asked. */
const recording = () => {
  const asked: CallRequest[] = [];
  const calls: CallPort = {
    invoke: request => {
      asked.push(request);
      return Promise.resolve({ ok: true, output: { status: "pass" } });
    },
    stopAll: () => {},
  };
  return { asked, calls };
};

/** A call port that answers every call with `result`. */
const callAnswering = (result: NodeResult): CallPort => ({
  ...recording().calls,
  invoke: () => Promise.resolve(result),
});

describe("workflow.call", () => {
  const CALL: Node = {
    type: "workflow.call",
    workflow: "feature-{{inputs.branch}}",
    inputs: { from: "{{nodes.builder.output.branch}}" },
  };

  it("renders what it asks for, and waits for the run by default", async () => {
    const { asked, calls } = recording();
    const result = await callExecutor(context("kit", CALL, { calls }));
    expect(result.ok).toBe(true);
    expect(asked[0]).toMatchObject({
      callId: "kit",
      workflow: "feature-feat/x y",
      inputs: { from: "ork/r1/builder" },
      wait: "run",
      channels: [],
    });
  });

  it("waits for a named node by default, and knows its channels", async () => {
    const { asked, calls } = recording();
    const node: Node = {
      type: "workflow.call",
      workflow: "feature",
      node: "builder",
    };
    await callExecutor(
      context("kit", node, {
        calls,
        workflow: {
          schemaVersion: 1,
          name: "t",
          nodes: { kit: node },
          messages: [{ between: ["writer", "kit"] }],
        },
      }),
    );
    expect(asked[0]).toMatchObject({ wait: "node", channels: ["writer"] });
  });

  it("reads the item in a fanned call's inputs and ref", async () => {
    const { asked, calls } = recording();
    const node: Node = {
      type: "workflow.call",
      workflow: "feature",
      ref: "{{item.ref}}",
      inputs: { title: "{{item.title}} {{index}}" },
    };
    await callExecutor(
      context("kit", node, {
        calls,
        item: { of: "kit", index: 1, value: { ref: "main", title: "docs" } },
      }),
    );
    expect(asked[0]).toMatchObject({
      ref: "main",
      inputs: { title: "docs 1" },
    });
  });

  it("passes on the run's budget, not a quota the called run reads itself", async () => {
    const { asked, calls } = recording();
    await callExecutor(
      context("kit", CALL, {
        calls,
        budgetLeftUsd: 0.5,
        budgetLeftNow: () => 9,
      }),
    );
    expect(asked[0]).toMatchObject({ budgetLeftUsd: 9 });
  });

  it.each([
    [
      "ended by a quota",
      { ok: false, output: { runStatus: "quota_exhausted" }, error: "spent" },
      "spent",
    ],
    [
      "refused at its start",
      { ok: false, output: {}, error: "Not started: its quota is spent." },
      "Not started: its quota is spent.",
    ],
  ])("is cut off when the called run was %s", async (_name, result, why) => {
    const called = await callExecutor(
      context("kit", CALL, { calls: callAnswering(result) }),
    );
    expect(called.limited).toBe(why);
  });

  it("is an ordinary failure otherwise", async () => {
    const called = await callExecutor(
      context("kit", CALL, {
        calls: callAnswering({
          ok: false,
          output: { runStatus: "failed" },
          error: "tests are red",
        }),
      }),
    );
    expect(called.limited).toBeUndefined();
  });

  it("fails when the run has no way to call", async () => {
    await expect(callExecutor(context("kit", CALL))).resolves.toMatchObject({
      ok: false,
      error: "This run cannot call workflows.",
    });
  });
});
