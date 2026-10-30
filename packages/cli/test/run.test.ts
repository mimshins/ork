import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type { ClaudeRuntime, HumanChannel } from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import {
  createTerminalHuman,
  flagValues,
  pickOption,
  previewInput,
  resolveWorkflowArg,
  type RunNodeOptions,
  runNode,
  runWorkflowFile,
  type RunWorkflowOptions,
} from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: review",
  "inputs:",
  "  branch: { type: string, required: true }",
  "nodes:",
  "  approver:",
  "    type: claude.worker",
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

const project = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-run-"));
  writeFileSync(path.join(dir, "review.ork.yaml"), WORKFLOW);
  return dir;
};

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const options = (overrides: Partial<RunNodeOptions>) => {
  const out: string[] = [];
  const err: string[] = [];
  const drivers: string[] = [];
  const runtime = (driver: string): Promise<ClaudeRuntime> => {
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
    human: recommending,
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
    if (chunk.includes("Allow?") || chunk.includes("Choose")) {
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
    expect(run.drivers).toEqual(["sdk"]);
    expect(result.outcome?.report).toEqual({
      status: "pass",
      summary: "tools: ask_user,permission",
      artifacts: { notes: "notes.md" },
      fields: { verdict: "approve" },
    });
    expect(run.out).toEqual([
      "▸ approver (haiku, session fake-1)",
      "  Working on: Review feat/x",
      "  · mcp__ork__ask_user {}",
      "✓ approver pass: tools: ask_user,permission",
      "  notes: notes.md",
      '  verdict: "approve"',
      "  $0.0123 · 100 in / 20 out (80 cached) · 2 turns · 1.5s",
    ]);
    expect(run.err).toEqual([]);
  });

  it("streams events as JSON lines with a driver override", async () => {
    const run = options({ json: true, driver: "cli" });
    await runNode(run.value);
    expect(run.drivers).toEqual(["cli"]);
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

  it("stops before any session on bad inputs or nodes", async () => {
    const missing = options({ inputs: [] });
    expect((await runNode(missing.value)).exitCode).toBe(1);
    expect(missing.err).toEqual([
      'missing required input "branch" (--input branch=…)',
    ]);

    const tool = options({ nodeId: "merge" });
    await runNode(tool.value);
    expect(tool.err).toEqual(['"merge" is a tool.gh, not a Claude node']);
    expect([...missing.drivers, ...tool.drivers]).toEqual([]);
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

  it("picks an option by number, id, or the recommended default", () => {
    expect(pickOption("2", options3, "a")).toBe("b");
    expect(pickOption("c", options3, "a")).toBe("c");
    expect(pickOption("", options3, "a")).toBe("a");
    expect(pickOption("9", options3, "a")).toBeUndefined();
  });

  it("previews what a tool will do on one line", () => {
    expect(previewInput("Bash", { command: "ls\n  -la" })).toBe(
      "Bash command: ls -la",
    );
    expect(previewInput("Grep", { pattern: "x".repeat(200) })).toHaveLength(
      165,
    );
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
});

const PIPELINE = [
  "schemaVersion: 1",
  "name: pipeline",
  "inputs:",
  "  branch: { type: string, required: true }",
  "nodes:",
  "  plan:",
  "    type: claude.worker",
  "    isolation: shared",
  '    prompt: "Plan {{inputs.branch}}"',
  "  review:",
  "    type: claude.worker",
  "    isolation: readonly",
  '    prompt: "Review the plan: {{nodes.plan.output.summary}}"',
  "    output: { schema: { verdict: [approve, escalate] } }",
  "  ship:",
  "    type: tool.shell",
  '    command: "echo {{nodes.review.output.verdict}}"',
  "  build:",
  "    type: claude.worker",
  "edges:",
  "  - plan -> review",
  "  - { from: review, to: ship, when: \"verdict == 'approve'\" }",
  "",
].join("\n");

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
    human: recommending,
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
  it("runs every node through the scheduler and prints a summary", async () => {
    const run = pipeline({});
    const { exitCode, result } = await runWorkflowFile(run.value);

    expect(exitCode).toBe(0);
    expect(result?.status).toBe("succeeded");
    expect(run.commands).toEqual(["echo approve"]);
    expect(run.out).toContain(
      "review │ ✓ pass: tools: ask_user,permission · $0.0123",
    );
    expect(run.out).toContain("ship   │ ✓ exit 0");
    expect(run.out).toContain("plan   │ Working on: Plan feat/x");
    expect(run.out.at(-1)).toMatch(
      /^✓ run [0-9a-f]{8} succeeded · \$0\.0369 · 4 ran, 0 skipped$/u,
    );
  });

  it("refuses worktree nodes until the worktree manager, unless --in-place", async () => {
    const run = pipeline({ inPlace: false });
    expect((await runWorkflowFile(run.value)).exitCode).toBe(1);
    expect(run.err).toEqual([
      "build use worktree isolation, which arrives with the worktree manager; pass --in-place to run them in this checkout",
    ]);
  });
});
