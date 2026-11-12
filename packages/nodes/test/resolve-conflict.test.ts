/**
 * @file Runs the `resolve-conflict` example for real against a git checkout
 *   stopped mid-rebase, with a fake resolver session: its tool steps are the
 *   shipped scripts. A clean resolution finishes with no question, a changed
 *   behaviour asks with both sides and the result shown, a failing check or a
 *   `stop` answer leaves the work in the checkout, and an edit outside the
 *   conflict is refused.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  compileWorkflow,
  type HumanQuestion,
  type NodeExecutor,
  type NodeOutput,
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { gateExecutor, spawnTool, toolExecutor } from "../src/index.ts";

const TEXT = readFileSync(
  new URL("../../../examples/resolve-conflict.ork.yaml", import.meta.url),
  "utf8",
);

const parsedOrThrow = () => {
  const parsed = parseWorkflow(TEXT);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const graph = () => {
  const compiled = compileWorkflow(parsedOrThrow());
  if (compiled.graph === null) {
    throw new Error(JSON.stringify(compiled.diagnostics));
  }
  return compiled.graph;
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });

/** Commits `text` as `file` on the current branch. */
const commit = (cwd: string, file: string, text: string, message: string) => {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", message);
};

/**
 * A checkout whose `feature` branch was rebased onto `main` and stopped on a
 * conflict in `app.txt`; with `rebase: false`, one with nothing in progress.
 */
type Sides = { base: string; upstream: string; change: string };

const stopped = (sides: Sides, rebase = true) => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-resolve-")));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  commit(cwd, "app.txt", sides.base, "base");
  git(cwd, "checkout", "-q", "-b", "feature");
  commit(cwd, "app.txt", sides.change, "the change");
  git(cwd, "checkout", "-q", "main");
  commit(cwd, "app.txt", sides.upstream, "upstream");
  git(cwd, "checkout", "-q", "feature");
  if (rebase) {
    try {
      git(cwd, "rebase", "main");
    } catch {
      // The conflict is the point.
    }
  }
  return cwd;
};

const ADDS: Sides = {
  base: "one\ntwo\n",
  upstream: "one\ntwo\nup\n",
  change: "one\ntwo\nmine\n",
};
const LIMIT: Sides = {
  base: "limit = 10\n",
  upstream: "limit = 20\n",
  change: "limit = 30\n",
};

/** What the fake resolver does in the checkout, and reports. */
type Resolver = { write: Record<string, string>; report: NodeOutput };

const merged = (text: string, behaviour: string): Resolver => ({
  write: { "app.txt": text },
  report: { status: "pass", summary: "resolved", kept: "both", behaviour },
});

const run = async (
  cwd: string,
  resolver: Resolver,
  options: { check?: string; answer?: string } = {},
) => {
  const ran: string[] = [];
  const asked: HumanQuestion[] = [];
  const tool = toolExecutor(spawnTool, { environ: process.env });
  const track =
    (inner: NodeExecutor): NodeExecutor =>
    context => {
      ran.push(context.id);
      return inner(context);
    };
  const resolve: NodeExecutor = context => {
    for (const [file, text] of Object.entries(resolver.write)) {
      writeFileSync(path.join(context.cwd, file), text);
    }
    return Promise.resolve({ ok: true, output: resolver.report });
  };
  const result = await startRun({
    graph: graph(),
    inputs: { check: options.check ?? "true" },
    cwd,
    executors: {
      "tool.shell": track(tool),
      "agent.worker": track(resolve),
      "human.gate": track(gateExecutor),
    },
    human: {
      ask: question => {
        asked.push(question);
        return Promise.resolve(options.answer ?? "keep");
      },
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: () => {},
  }).done;
  return { result, ran, asked };
};

const inProgress = (cwd: string) =>
  existsSync(path.join(cwd, ".git", "rebase-merge"));

const subjects = (cwd: string) =>
  git(cwd, "log", "--format=%s").trim().split("\n");

describe("the resolve-conflict example", () => {
  it("is in canonical form and checks with no finding", () => {
    expect(serializeWorkflow(parsedOrThrow())).toBe(TEXT);
    expect(compileWorkflow(parsedOrThrow()).diagnostics).toEqual([]);
  });
});

describe("resolving a stopped rebase", () => {
  it("resolves a clean conflict with no question, finishes and checks", async () => {
    const cwd = stopped(ADDS);
    const { result, ran, asked } = await run(
      cwd,
      merged("one\ntwo\nup\nmine\n", "unchanged"),
    );
    expect(result.status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(ran).toEqual(["inspect", "resolve", "stage", "finish", "check"]);
    expect(inProgress(cwd)).toBe(false);
    expect(subjects(cwd)).toEqual(["the change", "upstream", "base"]);
    expect(readFileSync(path.join(cwd, "app.txt"), "utf8")).toBe(
      "one\ntwo\nup\nmine\n",
    );
  });

  it("asks when the behaviour changed, showing both sides and the result", async () => {
    const cwd = stopped(LIMIT);
    const { result, ran, asked } = await run(
      cwd,
      merged("limit = 25\n", "changed"),
    );
    expect(result.status).toBe("succeeded");
    expect(ran).toEqual([
      "inspect",
      "resolve",
      "stage",
      "ask",
      "finish",
      "check",
    ]);
    const [question] = asked;
    expect(question?.document).toContain("+limit = 20");
    expect(question?.document).toContain("+limit = 30");
    expect(question?.document).toContain("+limit = 25");
    expect(question?.document).toContain("both");
    expect(subjects(cwd)[0]).toBe("the change");
  });

  it("stops at the answer `stop`, with the resolution staged and the rebase open", async () => {
    const cwd = stopped(LIMIT);
    const { result, ran } = await run(cwd, merged("limit = 25\n", "changed"), {
      answer: "stop",
    });
    expect(result.status).toBe("failed");
    expect(ran).toEqual(["inspect", "resolve", "stage", "ask", "stop"]);
    expect(inProgress(cwd)).toBe(true);
    expect(git(cwd, "diff", "--cached")).toContain("+limit = 25");
  });

  it("fails on a failing check and leaves the resolved work in the checkout", async () => {
    const cwd = stopped(ADDS);
    const { result, ran } = await run(
      cwd,
      merged("one\ntwo\nup\nmine\n", "unchanged"),
      {
        check: "test -f never-there",
      },
    );
    expect(result.status).toBe("failed");
    expect(ran.at(-1)).toBe("check");
    expect(inProgress(cwd)).toBe(false);
    expect(subjects(cwd)[0]).toBe("the change");
    expect(readFileSync(path.join(cwd, "app.txt"), "utf8")).toBe(
      "one\ntwo\nup\nmine\n",
    );
  });

  it("refuses a file edited outside the conflict", async () => {
    const cwd = stopped(ADDS);
    const { result, ran } = await run(cwd, {
      write: { "app.txt": "one\ntwo\nup\nmine\n", "extra.txt": "stray\n" },
      report: {
        status: "pass",
        summary: "x",
        kept: "both",
        behaviour: "unchanged",
      },
    });
    expect(result.status).toBe("failed");
    expect(ran).toEqual(["inspect", "resolve", "stage"]);
    expect(inProgress(cwd)).toBe(true);
  });

  it("refuses a conflict marker left behind", async () => {
    const cwd = stopped(ADDS);
    const { result, ran } = await run(
      cwd,
      merged("one\ntwo\n<<<<<<< HEAD\nup\n", "unchanged"),
    );
    expect(result.status).toBe("failed");
    expect(ran).toEqual(["inspect", "resolve", "stage"]);
  });

  it("does nothing when no rebase is in progress", async () => {
    const cwd = stopped(LIMIT, false);
    const { result, ran } = await run(cwd, merged("x\n", "unchanged"));
    expect(result.status).toBe("failed");
    expect(ran).toEqual(["inspect"]);
  });
});
