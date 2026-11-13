/**
 * @file Tests for `ork run`: one node and whole workflows against a stand-in
 *   `claude`, worktree runs in real git repositories, argument handling, and
 *   the terminal channel.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  type AgentRuntime,
  type HumanChannel,
  openStore,
  workflowTextHash,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import {
  createTerminalHuman,
  flagValues,
  previewInput,
  resolveWorkflowArg,
  type RunNodeOptions,
  runNode,
  runWorkflowFile,
  type RunWorkflowOptions,
} from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: review",
  "inputs:",
  "  branch: { type: string, required: true }",
  "nodes:",
  "  approver:",
  "    type: agent.worker",
  "    model: haiku",
  "    isolation: readonly",
  '    prompt: "Review {{inputs.branch}}"',
  "    output: { schema: { verdict: [approve, escalate] } }",
  "  merge:",
  "    type: tool.gh",
  "    command: pr merge --squash",
  "edges:",
  "  - approver -> merge",
  "",
].join("\n");

/** `approver` fanned out by the `forEach` that replaces `ITEMS`. */
const FANNED = [
  "schemaVersion: 1",
  "name: review",
  "nodes:",
  "  plan:",
  "    type: tool.shell",
  "    command: plan",
  "    output: { format: json, schema: { tasks: { list: {} } } }",
  "  approver:",
  "    type: agent.worker",
  "    model: haiku",
  "    isolation: readonly",
  "    forEach: ITEMS",
  '    prompt: "Review"',
  "edges:",
  "  - plan -> approver",
  "",
].join("\n");

const project = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-run-"));
  writeFileSync(path.join(dir, "review.ork.yaml"), WORKFLOW);
  return dir;
};

/**
 * Proven, able descriptors for the stand-in sessions (the real open-code is
 * unproven).
 */
const standInDrivers: NonNullable<RunWorkflowOptions["drivers"]> = (
  ["claude-code", "open-code", "command-code"] as const
).map(id => ({
  id,
  proven: true,
  onePerCheckout: id === "command-code",
  capabilities: {
    questions: true,
    permissionPrompt: true,
    price: true,
    midTurnMessages: true,
    reportSchema: true,
    turnLimit: true,
    mcpServers: true,
    subagents: true,
  },
}));

/**
 * Only open-code is ready: not the preferred driver, so a test sees which one a
 * run took.
 */
const openCodeReady: RunWorkflowOptions["driverChecks"] = () =>
  Promise.resolve([
    {
      id: "open-code",
      result: { name: "open-code", status: "ok", detail: "open-code is ready" },
    },
  ]);

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const options = (overrides: Partial<RunNodeOptions>) => {
  const out: string[] = [];
  const err: string[] = [];
  const drivers: string[] = [];
  const runtime = (driver: string): Promise<AgentRuntime> => {
    drivers.push(driver);
    return Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE }));
  };
  const value: RunNodeOptions = {
    file: "review.ork.yaml",
    cwd: project(),
    nodeId: "approver",
    inputs: ["branch=feat/x"],
    inPlace: false,
    json: false,
    runtime,
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human: recommending,
    store: openStore(":memory:"),
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
    ...overrides,
  };
  return { value, out, err, drivers };
};

/** Feeds `answers` to a terminal channel, one line per prompt. */
const terminal = (answers: string[], interactive = true) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const said: string[] = [];
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    said.push(chunk);
    if (
      chunk.includes("Allow?") ||
      chunk.includes("Choose") ||
      chunk.includes("Note for the run")
    ) {
      input.write(`${answers.shift() ?? ""}\n`);
    }
  });
  const human = createTerminalHuman({ input, output, interactive });
  return { human, said };
};

describe("ork run --node", () => {
  it("runs one node through a driver and prints its report", async () => {
    const run = options({});
    const result = await runNode(run.value);

    expect(result.exitCode).toBe(0);
    expect(run.drivers).toEqual(["open-code"]);
    expect(result.outcome?.report).toEqual({
      status: "pass",
      summary: "tools: ask_user,permission,feedback,follow_up",
      artifacts: { notes: "notes.md" },
      fields: { verdict: "approve" },
    });
    expect(run.out).toEqual([
      "▸ approver (haiku, session fake-1)",
      "  Working on: Review feat/x",
      "  · mcp__ork__ask_user {}",
      "✓ approver pass: tools: ask_user,permission,feedback,follow_up",
      "  notes: notes.md",
      '  verdict: "approve"',
      "  $0.0123 · 100 in / 20 out (80 cached) · 2 turns · 1.5s",
    ]);
    expect(run.err).toEqual([
      "No driver is named, so the run uses the open-code driver: the one ready here (open-code is ready).",
    ]);
  });

  it("says an inherited before: step does not run", async () => {
    const run = options({});
    writeFileSync(
      path.join(run.value.cwd, "review.ork.yaml"),
      WORKFLOW.replace(
        "nodes:",
        "defaults:\n  before: { command: 'true' }\nnodes:",
      ),
    );
    await runNode(run.value);
    expect(run.err.join("\n")).toContain(
      "approver's before: does not run in a run of one node.",
    );
  });

  it("streams events as JSON lines with a driver override", async () => {
    const run = options({
      json: true,
      driver: "claude-code",
      driverChecks: () =>
        Promise.resolve([
          {
            id: "claude-code",
            result: { name: "claude", status: "ok", detail: "ready" },
          },
        ]),
    });
    await runNode(run.value);
    expect(run.drivers).toEqual(["claude-code"]);
    expect(run.out.map(line => /^\{"type":"([^"]+)"/u.exec(line)?.[1])).toEqual(
      [
        "session.started",
        "assistant.text",
        "tool.called",
        "tool.result",
        "session.finished",
      ],
    );
  });

  it("refuses a --driver whose tool isn't ready, before any session", async () => {
    const run = options({
      driver: "claude-code",
      driverChecks: () =>
        Promise.resolve([
          {
            id: "claude-code",
            result: {
              name: "claude",
              status: "warn",
              detail: "claude-code is not ready",
              hint: "Sign in to claude.",
            },
          },
          {
            id: "open-code",
            result: { name: "open-code", status: "ok", detail: "ready" },
          },
        ]),
    });
    const result = await runNode(run.value);
    expect(result.exitCode).toBe(1);
    expect(run.drivers).toEqual([]);
    expect(run.err[0]).toBe(
      "--driver claude-code: claude-code isn't ready here (claude-code is not ready).",
    );
  });

  it("stops before any session on bad inputs or nodes", async () => {
    const missing = options({ inputs: [] });
    expect((await runNode(missing.value)).exitCode).toBe(1);
    expect(missing.err).toEqual([
      "missing required input `branch` (`--input branch=…`)",
    ]);

    const tool = options({ nodeId: "merge" });
    await runNode(tool.value);
    expect(tool.err).toEqual(["`merge` is a `tool.gh`, not a Claude node"]);
    expect([...missing.drivers, ...tool.drivers]).toEqual([]);
  });

  it("refuses a node that fans out over another node's list, naming it", async () => {
    const run = options({ inputs: [] });
    writeFileSync(
      path.join(run.value.cwd, "review.ork.yaml"),
      FANNED.replace(
        "ITEMS",
        '{ from: "{{nodes.plan.output.json.tasks}}", maxItems: 3 }',
      ),
    );
    const result = await runNode(run.value);
    expect(result.exitCode).toBe(1);
    expect(run.err).toEqual([
      "`approver` runs once for each item of {{nodes.plan.output.json.tasks}}, a list another node reports, and a run of one node does not run that node; run the whole workflow, or give it `items` of its own",
    ]);
    expect(run.drivers).toEqual([]);
  });

  it("runs a node with a static list once, and says it does not fan out", async () => {
    const run = options({ inputs: [] });
    writeFileSync(
      path.join(run.value.cwd, "review.ork.yaml"),
      FANNED.replace("ITEMS", "{ items: [a, b] }"),
    );
    const result = await runNode(run.value);
    expect(result.exitCode).toBe(0);
    expect(run.err.join("\n")).toContain(
      "approver's forEach: does not fan out in a run of one node: it runs once, with no item.",
    );
  });

  it("reports workflow errors as validate does", async () => {
    const run = options({ file: "nope.ork.yaml" });
    await runNode(run.value);
    expect(run.err).toEqual([
      "nope.ork.yaml error file not found (file.read)",
      "✗ nope.ork.yaml (1 error, 0 warnings)",
    ]);
  });
});

describe("arguments", () => {
  it("collects a repeatable flag", () => {
    expect(
      flagValues(
        ["wf", "--input", "a=1", "--input=b=2", "--node", "x"],
        "--input",
      ),
    ).toEqual(["a=1", "b=2"]);
  });

  it("finds a workflow by name in .ork/workflows", () => {
    const dir = project();
    expect(resolveWorkflowArg("review.ork.yaml", dir)).toBe("review.ork.yaml");
    expect(resolveWorkflowArg("hello", dir)).toBe("hello");
  });
});

describe("the terminal channel", () => {
  const options3 = [{ id: "a" }, { id: "b", label: "B" }, { id: "c" }];

  it("previews what a tool will do on one line", () => {
    expect(previewInput("Bash", { command: "ls\n  -la" })).toBe(
      "Bash command: ls -la",
    );
    expect(previewInput("Grep", { pattern: "x".repeat(200) })).toHaveLength(
      165,
    );
  });

  const LONG = Array.from({ length: 41 }, (_, i) => `line ${String(i)}`).join(
    "\n",
  );
  const gate = { nodeId: "n", question: "Which?", options: options3 };

  it("prints a short document before the question", async () => {
    const { human, said } = terminal(["2"]);
    const short = LONG.split("\n").slice(0, 40).join("\n");
    await human.ask({ ...gate, document: `${short}\n` });
    const out = said.join("");
    expect(out.indexOf("line 39")).toBeLessThan(out.indexOf("asks: Which?"));
    expect(out).not.toContain("Type d");
  });

  it("offers a long document, prints it on d, and asks again", async () => {
    const { human, said } = terminal(["d", "2"]);
    expect(await human.ask({ ...gate, document: LONG })).toBe("b");
    const out = said.join("");
    expect(out).toContain("Document: 41 lines. Type d to read it.");
    expect(out.indexOf("Type d")).toBeLessThan(out.indexOf("line 40"));
    expect(out).toContain("line 40");
  });

  it("lets an option named d win over reading the document", async () => {
    const { human, said } = terminal(["d"]);
    const answer = await human.ask({
      ...gate,
      options: [{ id: "c" }, { id: "d" }],
      document: LONG,
    });
    expect(answer).toBe("d");
    expect(said.join("")).not.toContain("line 40");
  });

  it("takes d as a wrong answer when there is no document", async () => {
    const { human, said } = terminal(["d", "2"]);
    expect(await human.ask(gate)).toBe("b");
    expect(said.join("")).toContain("Type an option's number or id.");
  });

  it("asks until it gets a valid answer, and asks before allowing a tool", async () => {
    const { human, said } = terminal(["nine", "2", "y", ""]);
    const answer = await human.ask({
      nodeId: "n",
      question: "Which?",
      options: options3,
      recommended: "a",
    });
    const allowed = await human.permit({
      nodeId: "n",
      toolName: "Bash",
      input: { command: "ls" },
    });
    const denied = await human.permit({
      nodeId: "n",
      toolName: "Bash",
      input: { command: "rm -rf build" },
    });
    human.close();

    expect(answer).toBe("b");
    expect(allowed).toEqual({ allow: true });
    expect(denied).toEqual({
      allow: false,
      message: "The user did not allow this tool.",
    });
    expect(said.join("")).toContain("Type an option's number or id.");
  });

  it("takes an optional note after the choice, and Enter skips it", async () => {
    const { human, said } = terminal([
      "2",
      "Cut the API section",
      "1",
      "",
      "n",
      "Not in CI",
    ]);
    const notes: string[] = [];
    const onNote = (note: string): void => {
      notes.push(note);
    };
    const noted = await human.ask({
      nodeId: "n",
      question: "Which?",
      options: options3,
      onNote,
    });
    const skipped = await human.ask({
      nodeId: "n",
      question: "Which?",
      options: options3,
      onNote,
    });
    const denied = await human.permit({
      nodeId: "n",
      toolName: "Bash",
      input: { command: "rm -rf build" },
      onNote,
    });
    human.close();

    expect([noted, skipped]).toEqual(["b", "a"]);
    expect(denied).toMatchObject({ allow: false });
    expect(notes).toEqual(["Cut the API section", "Not in CI"]);
    expect(said.join("")).toContain(
      "Note for the run (optional, Enter to skip)",
    );
  });

  it("hands Ctrl-C at a prompt to the run's interrupt", async () => {
    const input = new PassThrough();
    const output = Object.assign(new PassThrough(), {
      isTTY: true,
      columns: 80,
    });
    let said = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      said += chunk;
    });
    let interrupts = 0;
    const human = createTerminalHuman({
      input,
      output,
      interactive: true,
      interrupt: () => {
        interrupts += 1;
      },
    });
    const withdraw = new AbortController();
    const asked = human.ask({
      nodeId: "gate",
      question: "Merge?",
      options: options3,
      signal: withdraw.signal,
    });
    await expect.poll(() => said).toContain("Choose");
    input.write("\u0003");
    await expect.poll(() => interrupts).toBe(1);
    withdraw.abort();
    await expect(asked).rejects.toThrow("aborted");
    human.close();
  });

  it("withdraws a question when its signal aborts, and asks the next one", async () => {
    const { human } = terminal([""]);
    const withdraw = new AbortController();
    const first = human.ask({
      nodeId: "gate",
      question: "Merge?",
      options: options3,
      signal: withdraw.signal,
    });
    withdraw.abort();
    await expect(first).rejects.toThrow("the question was withdrawn");
    const second = await human.ask({
      nodeId: "n",
      question: "Which?",
      options: options3,
      recommended: "c",
    });
    human.close();
    expect(second).toBe("c");
  });

  it("denies tools and defers questions when no one is at the terminal", async () => {
    const { human } = terminal([], false);
    expect(
      await human.ask({
        nodeId: "n",
        question: "Which?",
        options: options3,
        recommended: "a",
      }),
    ).toBe("a");
    expect(
      await human.permit({ nodeId: "n", toolName: "Bash", input: {} }),
    ).toMatchObject({ allow: false });
  });

  it("leaves a gate's question to ork decide when no one is at the terminal", async () => {
    const { human, said } = terminal([], false);
    const withdraw = new AbortController();
    const asked = human.ask({
      nodeId: "ratify",
      question: "Ratify?",
      options: options3,
      recommended: "a",
      waits: true,
      signal: withdraw.signal,
    });
    const later = new Promise<string>(resolve => {
      setTimeout(() => {
        resolve("still waiting");
      }, 50);
    });
    const first = await Promise.race([asked, later]);
    expect(first).toBe("still waiting");
    expect(said.join("")).toContain("ratify waits for ork decide");
    withdraw.abort(new Error("answered in ork decide"));
    await expect(asked).rejects.toThrow("answered in ork decide");
  });

  it("asks the next question while a gate waits elsewhere", async () => {
    const { human } = terminal([], false);
    void human
      .ask({
        nodeId: "ratify",
        question: "Ratify?",
        options: options3,
        waits: true,
        signal: new AbortController().signal,
      })
      .catch(() => null);
    expect(
      await human.ask({
        nodeId: "n",
        question: "Which?",
        options: options3,
        recommended: "b",
      }),
    ).toBe("b");
  });
});

const PIPELINE = [
  "schemaVersion: 1",
  "name: pipeline",
  "inputs:",
  "  branch: { type: string, required: true }",
  "nodes:",
  "  plan:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Plan {{inputs.branch}}"',
  "  review:",
  "    type: agent.worker",
  "    isolation: readonly",
  '    prompt: "Review the plan: {{nodes.plan.output.summary}}"',
  "    output: { schema: { verdict: [approve, escalate] } }",
  "  ship:",
  "    type: tool.shell",
  '    command: "echo {{nodes.review.output.verdict}}"',
  "  build:",
  "    type: agent.worker",
  "edges:",
  "  - plan -> review",
  "  - { from: review, to: ship, when: \"verdict == 'approve'\" }",
  "",
].join("\n");

/** A committed project with the pipeline workflow and a CLAUDE.md. */
const gitProject = (): string => {
  const dir = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-git-"))),
    "app",
  );
  mkdirSync(dir);
  writeFileSync(path.join(dir, "pipeline.ork.yaml"), PIPELINE);
  writeFileSync(path.join(dir, "CLAUDE.md"), "# App\n");
  writeFileSync(path.join(dir, ".gitignore"), ".ork/runs/\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "-A"],
    ["commit", "-q", "-m", "init"],
  ]) {
    execFileSync("git", args, { cwd: dir });
  }
  return dir;
};

const pipeline = (overrides: Partial<RunWorkflowOptions>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-wf-"));
  writeFileSync(path.join(dir, "pipeline.ork.yaml"), PIPELINE);
  const out: string[] = [];
  const err: string[] = [];
  const commands: string[] = [];
  const tools: ToolRunner = (program, args) => {
    commands.push([program, ...args].join(" "));
    return Promise.resolve({ exitCode: 0, stdout: "approve", stderr: "" });
  };
  const value: RunWorkflowOptions = {
    file: "pipeline.ork.yaml",
    cwd: dir,
    inputs: ["branch=feat/x"],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human: recommending,
    store: openStore(":memory:"),
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
    tools,
    ...overrides,
  };
  return { value, out, err, commands };
};

describe("ork run (a whole workflow)", () => {
  it("refuses a file that isn't the text it was told to expect", async () => {
    const run = pipeline({ expectWorkflow: workflowTextHash(`${PIPELINE}#`) });
    const { exitCode, result } = await runWorkflowFile(run.value);
    expect(exitCode).toBe(1);
    expect(result).toBeNull();
    expect(run.err.join("\n")).toContain("isn't what was accepted");
    expect(run.value.store.runs()).toEqual([]);
    expect(run.commands).toEqual([]);
    expect(run.out).toEqual([]);
  });

  it("refuses a file that still names a renamed node type, and says how to fix it", async () => {
    const run = pipeline({});
    writeFileSync(
      path.join(run.value.cwd, "pipeline.ork.yaml"),
      PIPELINE.replaceAll("agent.worker", "claude.worker"),
    );
    const { exitCode, result } = await runWorkflowFile(run.value);
    expect(exitCode).toBe(1);
    expect(result).toBeNull();
    expect(run.err.join("\n")).toContain(
      "`claude.worker` was renamed to `agent.worker`; run `ork migrate`",
    );
    expect(run.value.store.runs()).toEqual([]);
  });

  it("runs a file that is", async () => {
    const run = pipeline({ expectWorkflow: workflowTextHash(PIPELINE) });
    const { exitCode, result } = await runWorkflowFile(run.value);
    expect(exitCode).toBe(0);
    expect(result?.status).toBe("succeeded");
    expect(run.commands).toEqual(["echo approve"]);
    expect(run.value.store.runs()).toHaveLength(1);
  });

  it("runs every node through the scheduler and prints a summary", async () => {
    const run = pipeline({});
    const { exitCode, result } = await runWorkflowFile(run.value);

    expect(exitCode).toBe(0);
    expect(result?.status).toBe("succeeded");
    expect(run.commands).toEqual(["echo approve"]);
    expect(run.out).toContain(
      "review │ ✓ pass: tools: ask_user,permission,send_message,read_inbox,wait_for_messages,feedback,follow_up · $0.0123",
    );
    expect(run.out).toContain("ship   │ ✓ exit 0");
    expect(run.out).toContain("plan   │ Working on: Plan feat/x");
    expect(run.out.at(-1)).toMatch(
      /^✓ run [0-9a-f]{8} succeeded · \$0\.0369 · 4 ran, 0 skipped$/u,
    );
  });

  it("runs worktree nodes in worktrees beside the clone, and lists the kept ones", async () => {
    const dir = gitProject();
    const run = pipeline({ cwd: dir, inPlace: false });
    const { exitCode, result } = await runWorkflowFile(run.value);
    const runId = String(result?.runId);
    const build = path.join(`${dir}-worktrees`, `ork-${runId}-build`);

    expect(exitCode).toBe(0);
    expect(result?.worktrees).toEqual([
      {
        id: "build",
        path: build,
        branch: `ork/${runId}/build`,
        reason: "the run's result",
      },
    ]);
    expect(
      run.out.some(line => line.startsWith("build  │ ⎇ created ork/")),
    ).toBe(true);
    expect(run.out.at(-1)).toContain(`build: ork/${runId}/build at ${build}`);
  });

  it("refuses to start while instructions or skills are uncommitted", async () => {
    const dir = gitProject();
    writeFileSync(path.join(dir, "CLAUDE.md"), "# changed\n");
    const run = pipeline({ cwd: dir, inPlace: false });
    expect((await runWorkflowFile(run.value)).exitCode).toBe(1);
    expect(run.err).toEqual([
      "No driver is named, so the run uses the open-code driver: the one ready here (open-code is ready).",
      "These instructions, skills or agents have uncommitted changes, and the worktrees only get committed files:",
      "  CLAUDE.md",
      "Commit or stash them, or pass --allow-dirty to run with the committed versions.",
    ]);
    const allowed = pipeline({ cwd: dir, inPlace: false, allowDirty: true });
    expect((await runWorkflowFile(allowed.value)).exitCode).toBe(0);
  });

  it("needs a git repository for worktree nodes, unless --in-place", async () => {
    const run = pipeline({ inPlace: false });
    expect((await runWorkflowFile(run.value)).exitCode).toBe(1);
    expect(run.err.at(-1)).toMatch(
      /^build needs a git worktree, but .+ is not in a git repository with a commit; make a first commit/u,
    );
  });

  it("says need for several worktree nodes, and names the project, not its workflows folder", async () => {
    const run = pipeline({ inPlace: false });
    const dir = realpathSync(run.value.cwd);
    const folder = path.join(dir, ".ork", "workflows");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "pipeline.ork.yaml"),
      PIPELINE.replace(
        "edges:\n",
        "  deploy:\n    type: agent.worker\nedges:\n",
      ),
    );
    run.value.file = path.join(".ork", "workflows", "pipeline.ork.yaml");
    expect((await runWorkflowFile(run.value)).exitCode).toBe(1);
    expect(run.err.at(-1)).toMatch(
      new RegExp(
        `^build, deploy need a git worktree, but ${dir} is not in a git repository with a commit`,
        "u",
      ),
    );
  });
});
