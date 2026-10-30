/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  type ClaudeRuntime,
  createWorkspace,
  inspectProject,
  type RunEvent,
  type HumanChannel,
  parseInputPairs,
  resolveInputs,
  type RunHandle,
  type RunResult,
  startRun,
  type Workspace,
  projectRootOf,
} from "@krapht/ork-core";
import { builtinExecutors, type ToolRunner } from "@krapht/ork-nodes";
import { type Driver, isClaudeNode, type Workflow } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { style } from "../output.ts";
import { formatRunEvent } from "./format.ts";

export type RunWorkflowOptions = {
  file: string;
  cwd: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides every node's driver. */
  driver?: Driver;
  inPlace: boolean;
  /** Run even when agent files have uncommitted changes (ADR-020). */
  allowDirty?: boolean;
  /** Print the run's events as JSON lines instead of a transcript. */
  json: boolean;
  runtime: (driver: Driver) => Promise<ClaudeRuntime>;
  human: HumanChannel;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Runs tool nodes; the default spawns the real programs. */
  tools?: ToolRunner;
  onRun?: (handle: RunHandle) => void;
};

/** Why a run refuses to start with uncommitted agent files. */
export const dirtyAgentMessage = (files: readonly string[]): string[] => [
  "These instructions, skills or agents have uncommitted changes, and the worktrees only get committed files:",
  ...files.slice(0, 20).map(f => `  ${f}`),
  ...(files.length > 20 ? [`  … and ${String(files.length - 20)} more`] : []),
  "Commit or stash them, or pass --allow-dirty to run with the committed versions.",
];

export type RunWorkflowResult = {
  exitCode: number;
  result: RunResult | null;
};

/** Claude nodes that get their own worktree. */
export const worktreeNodes = (workflow: Workflow): string[] =>
  Object.entries(workflow.nodes)
    .filter(
      ([, node]) =>
        isClaudeNode(node) &&
        node.type !== "claude.subagent" &&
        (node.isolation ?? workflow.defaults?.isolation ?? "worktree") ===
          "worktree",
    )
    .map(([id]) => id);

/**
 * Runs a whole workflow: checks it and its inputs, then hands the compiled
 * graph to the scheduler with the built-in node types, and streams the run.
 */
export const runWorkflowFile = async (
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> => {
  const failed = (lines: string[]): RunWorkflowResult => {
    for (const line of lines) options.err(line);
    return { exitCode: 1, result: null };
  };

  const { report, workflow, graph } = loadWorkflow(options.file, options.cwd);
  if (workflow === null || graph === null) return failed(formatReport(report));

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  const inputs = resolveInputs(workflow, pairs.raw);
  if (!inputs.ok) return failed(inputs.errors);

  const runId = randomUUID().slice(0, 8);
  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const onEvent = (event: RunEvent): void => {
    if (options.json) {
      options.out(JSON.stringify(event));
      return;
    }
    for (const line of formatRunEvent(event, width, tools)) options.out(line);
  };

  let cwd = options.cwd;
  let workspace: Workspace | undefined;
  const isolated = worktreeNodes(workflow);
  if (isolated.length > 0 && !options.inPlace) {
    const project = await inspectProject(options.cwd);
    if (project === null) {
      return failed([
        `${isolated.join(", ")} need a git worktree, but ${options.cwd} is not in a git repository with a commit; pass --in-place to run them here`,
      ]);
    }
    if (project.dirtyAgentFiles.length > 0 && options.allowDirty !== true) {
      return failed(dirtyAgentMessage(project.dirtyAgentFiles));
    }
    if (project.dirtyOther > 0) {
      options.err(
        `${style(["yellow", "bold"], "warning")} ${String(project.dirtyOther)} uncommitted change(s) in this checkout are not in the worktrees`,
      );
    }
    cwd = project.root;
    workspace = createWorkspace({
      graph,
      runId,
      root: project.root,
      head: project.head,
      onEvent,
    });
  }

  const executorOptions: Parameters<typeof builtinExecutors>[0] = {
    runtimeFor: options.runtime,
    inPlace: options.inPlace,
  };
  if (options.driver !== undefined) executorOptions.driver = options.driver;
  if (options.tools !== undefined) executorOptions.tools = options.tools;

  const handle = startRun({
    graph,
    runId,
    inputs: inputs.inputs,
    cwd,
    executors: builtinExecutors(executorOptions),
    human: options.human,
    onEvent,
    workflowDir: path.dirname(path.resolve(options.cwd, options.file)),
    projectRoot: workspace === undefined ? projectRootOf(cwd) : cwd,
    ...(workspace === undefined ? {} : { workspace }),
  });
  options.onRun?.(handle);
  const result = await handle.done;
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
