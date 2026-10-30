import {
  type ClaudeRuntime,
  type HumanChannel,
  parseInputPairs,
  resolveInputs,
  type RunHandle,
  type RunResult,
  startRun,
} from "@krapht/ork-core";
import { builtinExecutors, type ToolRunner } from "@krapht/ork-nodes";
import { type Driver, isClaudeNode, type Workflow } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { formatRunEvent } from "./format.ts";

export type RunWorkflowOptions = {
  file: string;
  cwd: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides every node's driver. */
  driver?: Driver;
  inPlace: boolean;
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

export type RunWorkflowResult = {
  exitCode: number;
  result: RunResult | null;
};

/** Claude nodes that need a worktree, which arrives with the worktree manager. */
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

  const isolated = worktreeNodes(workflow);
  if (isolated.length > 0 && !options.inPlace) {
    return failed([
      `${isolated.join(", ")} use worktree isolation, which arrives with the worktree manager; pass --in-place to run them in this checkout`,
    ]);
  }

  const executorOptions: Parameters<typeof builtinExecutors>[0] = {
    runtimeFor: options.runtime,
    inPlace: options.inPlace,
  };
  if (options.driver !== undefined) executorOptions.driver = options.driver;
  if (options.tools !== undefined) executorOptions.tools = options.tools;

  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const handle = startRun({
    graph,
    inputs: inputs.inputs,
    cwd: options.cwd,
    executors: builtinExecutors(executorOptions),
    human: options.human,
    onEvent: event => {
      if (options.json) {
        options.out(JSON.stringify(event));
        return;
      }
      for (const line of formatRunEvent(event, width, tools)) {
        options.out(line);
      }
    },
  });
  options.onRun?.(handle);
  const result = await handle.done;
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
