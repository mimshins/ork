/**
 * @file Shared fixtures for tests that run nodes in real git worktrees: a
 *   temporary repository shaped like se-backend, a compiler that throws on
 *   errors, an executor that writes each node's files, and a run with a
 *   workspace.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";

import {
  compileWorkflow,
  type CompiledGraph,
  createReplay,
  createWorkspace,
  gitRulesOf,
  inspectProject,
  type NodeExecutor,
  type RunEvent,
  resolveBase,
  resumeState,
  startRun,
} from "../../src/index.ts";

export const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

export const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/** A repo shaped like se-backend: skills in `.ai`, linked from `.claude`. */
export const repo = (): string => {
  const root = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-wt-"))),
    "app",
  );
  mkdirSync(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "dev@example.com");
  sh(root, "config", "user.name", "Dev");
  sh(root, "config", "commit.gpgsign", "false");
  write(root, "CLAUDE.md", "# Project\n");
  write(
    root,
    ".gitignore",
    "CLAUDE.local.md\n.claude/settings.local.json\n.env\nsecret.txt\n.ork/runs/\n",
  );
  write(root, ".worktreeinclude", ".env\n");
  write(root, ".ai/skills/review/SKILL.md", "---\nname: review\n---\n");
  mkdirSync(path.join(root, ".claude"));
  symlinkSync("../.ai/skills", path.join(root, ".claude/skills"));
  write(root, "src/app.ts", "export {};\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  write(root, "CLAUDE.local.md", "personal\n");
  write(root, ".claude/settings.local.json", "{}\n");
  write(root, ".env", "TOKEN=local\n");
  write(root, "secret.txt", "not copied\n");
  return root;
};

export const compile = (yaml: string): CompiledGraph => {
  const parsed = parseWorkflow(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

export type Work = {
  files?: Record<string, string>;
  artifacts?: Record<string, string>;
};

/** Writes each node's files where it runs and records its cwd. */
export const working = (work: Record<string, Work>) => {
  const cwds: Record<string, string> = {};
  const prompts: Record<string, string | undefined> = {};
  const executor: NodeExecutor = context => {
    cwds[context.id] = context.cwd;
    prompts[context.id] = context.checkout?.branch;
    for (const [file, text] of Object.entries(work[context.id]?.files ?? {})) {
      write(context.cwd, file, text);
    }
    return Promise.resolve({
      ok: true,
      output: {
        status: "pass",
        summary: "ok",
        artifacts: work[context.id]?.artifacts ?? {},
      },
    });
  };
  return { executor, cwds, prompts };
};

export const runIn = async (
  root: string,
  graph: CompiledGraph,
  executor: NodeExecutor,
  /** For a resumed run: the run's events so far. */
  before?: RunEvent[],
  inputs: Record<string, string> = {},
) => {
  const state = before === undefined ? undefined : resumeState(before);
  const project = await inspectProject(root);
  if (project === null) throw new Error("not a repo");
  const events: RunEvent[] = [];
  const onEvent = (event: RunEvent) => {
    events.push(event);
  };
  const handle = startRun({
    graph,
    runId: "r1",
    inputs,
    cwd: root,
    executors: { "claude.leader": executor, "claude.worker": executor },
    human: {
      ask: () => Promise.resolve("stop"),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent,
    workspace: createWorkspace({
      graph,
      runId: "r1",
      root,
      head: await resolveBase(root, gitRulesOf(graph.workflow), inputs),
      inputs,
      onEvent,
      ...(state === undefined
        ? {}
        : { adopt: state.worktrees, known: state.branches }),
    }),
    ...(state === undefined ? {} : { replay: createReplay(state.history) }),
  });
  const result = await handle.done;
  const worktreeEvents = events.flatMap(e =>
    e.type === "worktree" ? [`${e.id} ${e.action}`] : [],
  );
  return { result, worktreeEvents, events };
};

