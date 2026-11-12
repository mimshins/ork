/**
 * @file Runs the `issues` example for real against a bare remote, with a fake
 *   `gh` and fake sessions (the builders, reviewers and resolver); its tool
 *   steps are the shipped scripts. Issues by numbers and by label are built and
 *   integrated one at a time into one branch and one pull request that closes
 *   them, an issue whose builder failed or whose review didn't pass is left out
 *   and unlabelled, a conflict goes through the resolver (and a changed
 *   behaviour through the question), and a second run adds to the same pull
 *   request.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  compileWorkflow,
  fileLockLedgers,
  type NodeExecutor,
  type NodeOutput,
  type RunEvent,
  type RunResult,
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gateExecutor, spawnTool, toolExecutor } from "../src/index.ts";

const TEXT = readFileSync(
  new URL("../../../examples/issues.ork.yaml", import.meta.url),
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

/** A `gh` that keeps its issues, labels and pull request in `$GH_DIR`. */
const FAKE_GH = `#!/bin/sh
d="$GH_DIR"
echo "$*" >> "$d/log"
case "$1 $2" in
  "label create") exit 0 ;;
  "issue view") cat "$d/issue-$3.json" ;;
  "issue list") cat "$d/list.json" ;;
  "issue edit") exit 0 ;;
  "pr view")
    [ -f "$d/pr" ] || exit 1
    case "$*" in
      *"--jq .body"*) cat "$d/pr-body" ;;
      *"--jq .url"*) echo https://example.test/pull/1 ;;
    esac
    ;;
  "pr create"|"pr edit")
    shift 2
    while [ $# -gt 0 ]; do
      case "$1" in --body) printf '%s\\n' "$2" > "$d/pr-body"; shift ;; esac
      shift
    done
    touch "$d/pr"
    echo https://example.test/pull/1
    ;;
  *) exit 1 ;;
esac
`;

type World = { base: string; project: string; remote: string; gh: string };

const world = (): World => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-issues-")));
  const remote = path.join(base, "remote.git");
  const project = path.join(base, "app");
  const gh = path.join(base, "gh");
  mkdirSync(path.join(base, "bin"));
  mkdirSync(gh);
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "init", "-q", "-b", "main", project);
  for (const [key, value] of [
    ["user.name", "t"],
    ["user.email", "t@example.com"],
    ["commit.gpgsign", "false"],
  ] as const) {
    git(project, "config", key, value);
  }
  writeFileSync(path.join(project, "app.txt"), "base\n");
  git(project, "add", "app.txt");
  git(project, "commit", "-q", "-m", "base");
  git(project, "remote", "add", "origin", remote);
  git(project, "push", "-q", "-u", "origin", "main");
  const bin = path.join(base, "bin", "gh");
  writeFileSync(bin, FAKE_GH);
  chmodSync(bin, 0o755);
  return { base, project, remote, gh };
};

/** The issues the fake `gh` knows, as `gh` would print them. */
const open = (w: World, ...numbers: number[]) => {
  const issues = numbers.map(number => ({
    number,
    title: `Issue ${String(number)}`,
    body: `Do ${String(number)}`,
  }));
  for (const issue of issues) {
    writeFileSync(
      path.join(w.gh, `issue-${String(issue.number)}.json`),
      JSON.stringify(issue),
    );
  }
  writeFileSync(path.join(w.gh, "list.json"), JSON.stringify(issues));
};

/** What a fake builder does for an issue: a file it writes, or a failure. */
type Build = { file: string; text: string } | "fail";

type Script = {
  builds: Record<number, Build>;
  /** The issues whose review doesn't pass. */
  rejected?: number[];
  /** What the resolver leaves in `app.txt`, and what it says of it. */
  resolution?: { text: string; behaviour: string };
  answer?: string;
  /** The `prepare` session reports a failure. */
  prepareFails?: boolean;
};

const numberOf = (value: unknown): number =>
  typeof value === "object" &&
  value !== null &&
  "number" in value &&
  typeof value.number === "number"
    ? value.number
    : -1;

const outputOf = (result: RunResult, name: string): string | undefined =>
  result.outputs?.[name];

const report = (output: NodeOutput) =>
  Promise.resolve({ ok: true as const, output });

const run = async (
  w: World,
  script: Script,
  inputs: Record<string, string>,
) => {
  const events: RunEvent[] = [];
  const asked: string[] = [];
  // The fake `gh` first on the PATH the tool nodes' programs start with.
  vi.stubEnv(
    "PATH",
    `${path.join(w.base, "bin")}:${process.env["PATH"] ?? ""}`,
  );
  vi.stubEnv("GH_DIR", w.gh);
  const tool = toolExecutor(spawnTool, { environ: process.env });
  let prepared = "";
  /** A worktree of the project on a branch of this run, as Ork makes one. */
  const worktree = (runId: string, id: string) => {
    const dir = path.join(w.base, `wt-${runId}-${id}`);
    const branch = `ork/${runId}/${id}`;
    git(w.project, "worktree", "add", "-q", "-b", branch, dir, "HEAD");
    return { dir, branch };
  };
  const agent: NodeExecutor = context => {
    const { id, runId } = context;
    if (id === "prepare" && script.prepareFails === true) {
      return Promise.resolve({
        ok: false as const,
        error: "could not prepare",
        output: { status: "fail", summary: "could not prepare" },
      });
    }
    if (id === "prepare") {
      const made = worktree(runId, id);
      prepared = made.dir;
      return report({
        status: "pass",
        summary: "ready",
        worktree: made.dir,
        branch: made.branch,
      });
    }
    if (id.startsWith("build.")) {
      const issue = numberOf(context.item?.value);
      const build = script.builds[issue];
      if (build === undefined || build === "fail") {
        return report({ status: "fail", summary: "could not build it" });
      }
      const made = worktree(runId, id);
      writeFileSync(path.join(made.dir, build.file), build.text);
      git(made.dir, "add", "-A");
      git(made.dir, "commit", "-q", "-m", `ork: ${id}`);
      return report({
        status: "pass",
        summary: "built",
        worktree: made.dir,
        branch: made.branch,
      });
    }
    if (id.startsWith("review.")) {
      const issue = numberOf(context.item?.value);
      return script.rejected?.includes(issue) === true
        ? report({ status: "changes_requested", summary: "misses a case" })
        : report({ status: "pass", summary: "fine" });
    }
    if (id === "resolve") {
      const { text, behaviour } = script.resolution ?? {
        text: "base\n",
        behaviour: "unchanged",
      };
      writeFileSync(path.join(prepared, "app.txt"), text);
      // Ork commits what a `continue` session leaves, here in the middle of the rebase.
      git(prepared, "add", "-A");
      git(prepared, "commit", "-q", "-m", `ork: ${id} (run ${runId})`);
      return report({ status: "pass", summary: "x", kept: "both", behaviour });
    }
    throw new Error(`Unexpected agent ${id}`);
  };
  const ran: string[] = [];
  const result = await startRun({
    graph: graph(),
    inputs: { check: "true", branch: "feature", base: "main", ...inputs },
    cwd: w.project,
    executors: {
      "tool.shell": tool,
      "tool.gh": tool,
      "agent.worker": agent,
      "human.gate": gateExecutor,
    },
    human: {
      ask: question => {
        asked.push(question.document ?? "");
        return Promise.resolve(script.answer ?? "keep");
      },
      permit: () => Promise.resolve({ allow: true }),
    },
    locks: fileLockLedgers({
      dir: path.join(w.base, "locks"),
      repo: w.project,
      project: w.project,
      pollMs: 10,
    }),
    onEvent: event => {
      events.push(event);
      if (event.type === "node.started") ran.push(event.id);
    },
  }).done;
  return { result, ran, asked, events };
};

const ghLog = (w: World): string[] =>
  readFileSync(path.join(w.gh, "log"), "utf8").trim().split("\n");

const subjects = (w: World, branch = "feature"): string[] =>
  git(w.remote, "log", "--format=%s", branch).trim().split("\n");

const body = (w: World): string =>
  readFileSync(path.join(w.gh, "pr-body"), "utf8");

const ONE: Build = { file: "one.txt", text: "1\n" };
const TWO: Build = { file: "two.txt", text: "2\n" };

describe("the issues example", () => {
  it("is in canonical form and checks with no finding", () => {
    expect(serializeWorkflow(parsedOrThrow())).toBe(TEXT);
    expect(compileWorkflow(parsedOrThrow()).diagnostics).toEqual([]);
  });
});

describe("working issues in parallel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("integrates issues named by number into one branch and one pull request", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, events } = await run(
      w,
      { builds: { 1: ONE, 2: TWO } },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
    expect(outputOf(result, "integrated")).toBe("#1\n#2\n");
    const log = ghLog(w);
    expect(log).toContain("issue edit 1 --add-label in-progress");
    expect(log).toContain("issue edit 2 --remove-label in-progress");
    expect(log.filter(line => line.startsWith("pr create"))).toHaveLength(1);
    // One hold on the branch's lock, from the first integration to the end.
    const taken = events.filter(event => event.type === "lock.taken");
    expect(taken.length).toBeGreaterThan(0);
    const released = events.filter(event => event.type === "lock.released");
    expect(released).toHaveLength(1);
  });

  it("does not start the resolver, or take the lock, when `prepare` fails", async () => {
    const w = world();
    open(w, 1);
    const { result, ran, events } = await run(
      w,
      { builds: { 1: ONE }, prepareFails: true },
      { issues: "1" },
    );
    expect(result.status).toBe("failed");
    expect(ran).toContain("prepare");
    for (const id of ["resolve", "inspect", "check", "push"]) {
      expect(ran).not.toContain(id);
    }
    expect(events.filter(event => event.type === "lock.taken")).toEqual([]);
  });

  it("takes the open issues of a label", async () => {
    const w = world();
    open(w, 1, 2);
    const { result } = await run(
      w,
      { builds: { 1: ONE, 2: TWO } },
      { label: "ready" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(ghLog(w)).toContain(
      'issue list --label ready --state open --limit 10 --json number,title,body --jq [.[] | {number, title, body: ((.body // "")[:4000])}]',
    );
    expect(body(w)).toContain("Closes #1\nCloses #2");
  });

  it("leaves out an issue whose builder failed or whose review didn't pass, unlabelled and named", async () => {
    const w = world();
    open(w, 1, 2, 3);
    const { result } = await run(
      w,
      {
        builds: { 1: ONE, 2: "fail", 3: { file: "three.txt", text: "3\n" } },
        rejected: [3],
      },
      { issues: "1,2,3" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(subjects(w)).toEqual(["Resolve #1: Issue 1", "base"]);
    expect(body(w)).toContain("Closes #1");
    expect(body(w)).not.toContain("#2");
    expect(body(w)).not.toContain("#3");
    expect(outputOf(result, "leftOut")).toContain("#2: its builder failed");
    expect(outputOf(result, "leftOut")).toContain(
      "#3: the review did not pass it: misses a case",
    );
    expect(ghLog(w)).toContain("issue edit 2 --remove-label in-progress");
    expect(ghLog(w)).toContain("issue edit 3 --remove-label in-progress");
  });

  it("adds a second run's issues to the same pull request", async () => {
    const w = world();
    open(w, 1, 2);
    await run(w, { builds: { 1: ONE } }, { issues: "1" });
    const second = await run(w, { builds: { 2: TWO } }, { issues: "2" });
    expect(second.result.reasons).toEqual([]);
    expect(second.result.status).toBe("succeeded");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
    const log = ghLog(w);
    expect(log.filter(line => line.startsWith("pr create"))).toHaveLength(1);
    expect(log.filter(line => line.startsWith("pr edit"))).toHaveLength(1);
  });

  it("resolves a conflict with the resolver, with no question for a clean merge", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, ran, asked } = await run(
      w,
      {
        builds: {
          1: { file: "app.txt", text: "base\none\n" },
          2: { file: "app.txt", text: "base\ntwo\n" },
        },
        resolution: { text: "base\none\ntwo\n", behaviour: "unchanged" },
      },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(ran).toContain("resolve");
    expect(ran).not.toContain("drop");
    expect(git(w.remote, "show", "feature:app.txt")).toBe("base\none\ntwo\n");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
  });

  it("asks when the resolution changes behaviour, and leaves the issue out at `stop`", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, ran, asked } = await run(
      w,
      {
        builds: {
          1: { file: "app.txt", text: "limit = 20\n" },
          2: { file: "app.txt", text: "limit = 30\n" },
        },
        resolution: { text: "limit = 25\n", behaviour: "changed" },
        answer: "stop",
      },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("#2");
    expect(asked[0]).toContain("+limit = 25");
    expect(ran).toContain("drop");
    expect(subjects(w)).toEqual(["Resolve #1: Issue 1", "base"]);
    expect(outputOf(result, "leftOut")).toContain("#2: its integration failed");
    expect(body(w)).not.toContain("#2");
  });
});
