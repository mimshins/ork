/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  type ClaudeRuntime,
  createRecorder,
  createWorkspace,
  type EventStore,
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
import {
  builtinExecutors,
  missingPrograms,
  onPath,
  type ToolRunner,
} from "@krapht/ork-nodes";
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
  /** Where the run is recorded (`~/.ork/state.db`; tests pass their own). */
  store: EventStore;
  /** Runs tool nodes; the default spawns the real programs. */
  tools?: ToolRunner;
  /**
   * Whether a tool program is installed; default: on `PATH` when `tools` is the
   * real runner.
   */
  installed?: (program: string) => boolean;
  onRun?: (handle: RunHandle) => void;
};

/** Why a run refuses to start with uncommitted agent files. */
export const dirtyAgentMessage = (files: readonly string[]): string[] => [
  "These instructions, skills or agents have uncommitted changes, and the worktrees only get committed files:",
  ...files.slice(0, 20).map(f => `  ${f}`),
  ...(files.length > 20 ? [`  … and ${String(files.length - 20)} more`] : []),
  "Commit or stash them, or pass --allow-dirty to run with the committed versions.",
];

/** Why a run refuses to start when a program its tool nodes need is missing. */
export const missingProgramMessage = (
  missing: ReturnType<typeof missingPrograms>,
): string[] => [
  "This workflow runs programs that are not installed:",
  ...missing.map(m => `  ${m.program}, for ${m.nodes.join(", ")} (${m.type})`),
  "Install them, or take those nodes out. Integrations are optional: only the ones a workflow uses must be installed (`ork doctor` shows what you have).",
];

/** A run id no stored run has yet. */
const newRunId = (store: EventStore): string => {
  for (;;) {
    const id = randomUUID().slice(0, 8);
    if (store.lookup(id).length === 0) return id;
  }
};

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

  const installed =
    options.installed ??
    (options.tools === undefined ? (p: string) => onPath(p) : () => true);
  const missing = missingPrograms(workflow, installed);
  if (missing.length > 0) return failed(missingProgramMessage(missing));

  let cwd = options.cwd;
  let gitProject: Awaited<ReturnType<typeof inspectProject>> = null;
  const isolated = worktreeNodes(workflow);
  if (isolated.length > 0 && !options.inPlace) {
    gitProject = await inspectProject(options.cwd);
    if (gitProject === null) {
      return failed([
        `${isolated.join(", ")} need a git worktree, but ${options.cwd} is not in a git repository with a commit; pass --in-place to run them here`,
      ]);
    }
    if (gitProject.dirtyAgentFiles.length > 0 && options.allowDirty !== true) {
      return failed(dirtyAgentMessage(gitProject.dirtyAgentFiles));
    }
    if (gitProject.dirtyOther > 0) {
      options.err(
        `${style(["yellow", "bold"], "warning")} ${String(gitProject.dirtyOther)} uncommitted change(s) in this checkout are not in the worktrees`,
      );
    }
    cwd = gitProject.root;
  }

  const runId = newRunId(options.store);
  const record = createRecorder(
    options.store,
    {
      id: runId,
      workflow: workflow.name,
      file: path.resolve(options.cwd, options.file),
      project: gitProject === null ? projectRootOf(cwd) : cwd,
    },
    path.join(cwd, ".ork", "runs", runId),
  );
  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const onEvent = (event: RunEvent): void => {
    record(event);
    if (options.json) {
      options.out(JSON.stringify(event));
      return;
    }
    for (const line of formatRunEvent(event, width, tools)) options.out(line);
  };
  const workspace: Workspace | undefined =
    gitProject === null
      ? undefined
      : createWorkspace({
          graph,
          runId,
          root: gitProject.root,
          head: gitProject.head,
          onEvent,
        });

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
