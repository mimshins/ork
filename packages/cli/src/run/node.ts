/**
 * @file `ork run --node`: checks a workflow and its inputs, plans one Claude
 *   node's session, streams it to the terminal, and records it as a run of one
 *   node.
 */

import path from "node:path";

import {
  type ClaudeRuntime,
  createRecorder,
  type EventStore,
  type HumanChannel,
  type RunEvent,
  startControl,
  parseInputPairs,
  planNodeSession,
  projectRootOf,
  resolveInputs,
  type Session,
  type SessionOutcome,
} from "@krapht/ork-core";
import { resultOf } from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { style } from "../output.ts";
import { formatEvent } from "./format.ts";
import { newRunId } from "./workflow.ts";

export type RunNodeOptions = {
  file: string;
  cwd: string;
  nodeId: string;
  /** `name=value` pairs, as given to `--input`. */
  inputs: readonly string[];
  /** Overrides the node's and the workflow's driver. */
  driver?: Driver;
  inPlace: boolean;
  /** Print the runtime events as JSON lines instead of a transcript. */
  json: boolean;
  runtime: (driver: Driver) => Promise<ClaudeRuntime>;
  /** The terminal; it races `ork decide`. None: questions wait for `ork decide`. */
  human?: HumanChannel;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  /** The run's id; `ork run --detach` picks it before the run starts. */
  runId?: string;
  /** Where the run is recorded (`~/.ork/state.db`; tests pass their own). */
  store: EventStore;
  out: (line: string) => void;
  err: (line: string) => void;
  onSession?: (session: Session) => void;
};

export type RunNodeResult = {
  exitCode: number;
  outcome: SessionOutcome | null;
};

const succeeded = (outcome: SessionOutcome | null): boolean =>
  outcome?.report !== null &&
  outcome?.report !== undefined &&
  outcome.report.status !== "fail";

/**
 * Runs one Claude node of a workflow on its own: checks the workflow and the
 * inputs, plans the session, and streams it to the terminal.
 */
export const runNode = async (
  options: RunNodeOptions,
): Promise<RunNodeResult> => {
  const failed = (lines: string[]): RunNodeResult => {
    for (const line of lines) options.err(line);
    return { exitCode: 1, outcome: null };
  };

  const { report, workflow } = loadWorkflow(options.file, options.cwd);
  if (workflow === null) return failed(formatReport(report));

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  const inputs = resolveInputs(workflow, pairs.raw);
  if (!inputs.ok) return failed(inputs.errors);

  const projectRoot = projectRootOf(options.cwd);
  const runId = options.runId ?? newRunId(options.store, "node-");
  const runDir = path.join(projectRoot, ".ork", "runs", runId);
  const plan = planNodeSession(workflow, options.nodeId, {
    cwd: options.cwd,
    inputs: inputs.inputs,
    inPlace: options.inPlace,
    workflowDir: path.dirname(path.resolve(options.cwd, options.file)),
    projectRoot,
    pluginDir: path.join(runDir, "plugins", options.nodeId),
  });
  if (!plan.ok) return failed([plan.error]);
  for (const warning of plan.warnings) {
    options.err(`${style(["yellow", "bold"], "warning")} ${warning}`);
  }

  const id = options.nodeId;
  const recorder = createRecorder(
    options.store,
    {
      id: runId,
      workflow: workflow.name,
      file: path.resolve(options.cwd, options.file),
      project: projectRoot,
    },
    runDir,
  );
  const started = Promise.withResolvers<Session>();
  const control = await startControl({
    store: options.store,
    runId,
    emit: event => {
      record(event);
    },
    onStop: () => {
      void started.promise.then(session => session.interrupt());
    },
    ...(options.human === undefined ? {} : { local: options.human }),
    ...(options.home === undefined ? {} : { home: options.home }),
  });
  const record = (event: RunEvent): void => {
    control.publish(recorder(event));
  };
  const nodeType = workflow.nodes[id]?.type ?? "claude.worker";
  record({
    type: "run.started",
    runId,
    workflow: workflow.name,
    entries: [id],
    nodes: [{ id, type: nodeType }],
  });
  record({ type: "node.started", id, nodeType, round: 1 });

  const runtime = await options.runtime(options.driver ?? plan.driver);
  const session = runtime.start(plan.spec, { human: control.human });
  started.resolve(session);
  options.onSession?.(session);

  const tools = new Map<string, string>();
  let outcome: SessionOutcome | null = null;
  for await (const event of session.events) {
    record({ type: "node.event", id, event });
    if (event.type === "session.finished") outcome = event.outcome;
    if (options.json) options.out(JSON.stringify(event));
    else
      for (const line of formatEvent(options.nodeId, event, tools)) {
        options.out(line);
      }
  }
  const result = resultOf(outcome);
  const costUsd = result.usage?.costUsd ?? 0;
  record({
    type: "node.finished",
    id,
    round: 1,
    ok: result.ok,
    output: result.output,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.error === undefined ? {} : { error: result.error }),
  });
  record({
    type: "run.finished",
    result: {
      runId,
      status: succeeded(outcome) ? "succeeded" : "failed",
      costUsd,
      nodes: [
        {
          id,
          runs: 1,
          ok: result.ok,
          output: result.output,
          costUsd,
          ...(result.error === undefined ? {} : { error: result.error }),
        },
      ],
      reasons: result.error === undefined ? [] : [`${id}: ${result.error}`],
      worktrees: [],
    },
  });
  await control.close();
  return { exitCode: succeeded(outcome) ? 0 : 1, outcome };
};

/** Every value of a repeatable flag: `--input a=1 --input=b=2`. */
