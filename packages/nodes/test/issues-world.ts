/**
 * @file The harness the `issues` example's tests share: a bare remote, a
 *   project with a commit, a fake `gh` that keeps its issues, labels and pull
 *   request in a folder and logs every call, and fake sessions for the
 *   builders, reviewers and resolver. `run` starts the shipped workflow for
 *   real against them, its tool steps being the shipped scripts.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
import { parseWorkflow } from "@krapht/ork-schema";
import { vi } from "vitest";

import { gateExecutor, spawnTool, toolExecutor } from "../src/index.ts";

export const TEXT = readFileSync(
  new URL("../../../examples/issues.ork.yaml", import.meta.url),
  "utf8",
);

export const parsedOrThrow = () => {
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

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });

/**
 * A `gh` that keeps its issues, labels and pull request in `$GH_DIR`. A file
 * `pr-create-fails` makes `pr create` fail, and a file `edit-fails-N` makes
 * `issue edit N` fail.
 */
const FAKE_GH = `#!/bin/sh
d="$GH_DIR"
echo "$*" >> "$d/log"
case "$1 $2" in
  "label create") exit 0 ;;
  "issue view")
    case "$*" in
      *"--json labels"*)
        if [ -f "$d/labels-$3.json" ]; then cat "$d/labels-$3.json"; else echo '{"labels":[]}'; fi
        ;;
      *) cat "$d/issue-$3.json" ;;
    esac
    ;;
  "issue list") cat "$d/list.json" ;;
  "issue edit")
    [ -f "$d/edit-fails-$3" ] && exit 1
    exit 0
    ;;
  "pr view")
    [ -f "$d/pr" ] || exit 1
    case "$*" in
      *"--jq .body"*) cat "$d/pr-body" ;;
      *"--jq .url"*) echo https://example.test/pull/1 ;;
    esac
    ;;
  "pr create"|"pr edit")
    [ -f "$d/pr-create-fails" ] && [ "$2" = create ] && exit 1
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

export type World = {
  base: string;
  project: string;
  remote: string;
  gh: string;
};

type WorldOptions = {
  /** Leave the project with no `origin` remote. */
  noOrigin?: boolean;
  /** Leave the project with no commit. */
  noCommit?: boolean;
};

export const world = (options: WorldOptions = {}): World => {
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
  if (options.noCommit !== true) {
    writeFileSync(path.join(project, "app.txt"), "base\n");
    git(project, "add", "app.txt");
    git(project, "commit", "-q", "-m", "base");
  }
  if (options.noOrigin !== true) {
    git(project, "remote", "add", "origin", remote);
    if (options.noCommit !== true) {
      git(project, "push", "-q", "-u", "origin", "main");
    }
  }
  const bin = path.join(base, "bin", "gh");
  writeFileSync(bin, FAKE_GH);
  chmodSync(bin, 0o755);
  return { base, project, remote, gh };
};

/** The issues the fake `gh` knows, as `gh` would print them. */
export const open = (w: World, ...numbers: number[]) => {
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

/** Gives an issue labels, as `gh issue view --json labels` prints them. */
export const labelled = (w: World, number: number, ...names: string[]) => {
  writeFileSync(
    path.join(w.gh, `labels-${String(number)}.json`),
    JSON.stringify({ labels: names.map(name => ({ name })) }),
  );
};

/** Makes the fake `gh pr create` fail. */
export const failPrCreate = (w: World) => {
  writeFileSync(path.join(w.gh, "pr-create-fails"), "");
};

/** Makes the fake `gh issue edit` fail for one issue. */
export const failEdit = (w: World, number: number) => {
  writeFileSync(path.join(w.gh, `edit-fails-${String(number)}`), "");
};

/**
 * What a fake builder does for an issue: a file it writes, a failure, or a pass
 * that leaves no branch.
 */
export type Build = { file: string; text: string } | "fail" | "no-branch";

export type Script = {
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

export const outputOf = (result: RunResult, name: string): string | undefined =>
  result.outputs?.[name];

const report = (output: NodeOutput) =>
  Promise.resolve({ ok: true as const, output });

export const run = async (
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
      if (build === "no-branch") {
        return report({ status: "pass", summary: "built" });
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

/** What a tool node printed on stderr, from its `node.finished` event. */
export const stderrOf = (events: RunEvent[], id: string): string => {
  const finished = events.find(
    event => event.type === "node.finished" && event.id === id,
  );
  return finished?.type === "node.finished" &&
    typeof finished.output["stderr"] === "string"
    ? finished.output["stderr"]
    : "";
};

/** Every call the fake `gh` took, one line each; none when it was never called. */
export const ghLog = (w: World): string[] => {
  const file = path.join(w.gh, "log");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8").trim();
  return text === "" ? [] : text.split("\n");
};

export const subjects = (w: World, branch = "feature"): string[] =>
  git(w.remote, "log", "--format=%s", branch).trim().split("\n");

export const body = (w: World): string =>
  readFileSync(path.join(w.gh, "pr-body"), "utf8");

export const ONE: Build = { file: "one.txt", text: "1\n" };
export const TWO: Build = { file: "two.txt", text: "2\n" };
