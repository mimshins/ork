/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run. `ork resume` comes through here too, with the
 *   run's recorded state.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  type ClaudeRuntime,
  appendRecorder,
  createRecorder,
  createReplay,
  createSignals,
  replayLoopAnswers,
  type ResumeState,
  createWorkspace,
  startControl,
  type EventStore,
  type RunEvent,
  type HumanChannel,
  parseInputPairs,
  resolveInputs,
  type RunHandle,
  type RunResult,
  startRun,
  type Workspace,
  inside,
  runDirOf,
} from "@krapht/ork-core";
import {
  builtinExecutors,
  missingPrograms,
  onPath,
  type ToolRunner,
} from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { prepareCheckout } from "./checkout.ts";
import { formatRunEvent } from "./format.ts";
import { feedbackOrigin } from "./origin.ts";

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
  /**
   * The run's own terminal; it races `ork decide` for every question. None for
   * a detached run, whose questions wait for `ork decide`.
   */
  human?: HumanChannel;
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
  /** The run's id; `ork run --detach` picks it before the run starts. */
  runId?: string;
  /** `~`, for the run's socket; tests pass a folder. */
  home?: string;
  /** How often the run looks at the store for answers and commands. */
  intervalMs?: number;
  /** `ork resume`: continue the run `runId` from its recorded state. */
  resume?: ResumeState;
  onRun?: (handle: RunHandle) => void;
};

/** Why a run refuses to start when a program its tool nodes need is missing. */
export const missingProgramMessage = (
  missing: ReturnType<typeof missingPrograms>,
): string[] => [
  "This workflow runs programs that are not installed:",
  ...missing.map(m => `  ${m.program}, for ${m.nodes.join(", ")} (${m.type})`),
  "Install them, or take those nodes out. Integrations are optional: only the ones a workflow uses must be installed (`ork doctor` shows what you have).",
];

/** A run id no stored run has yet; `node-…` for a run of one node. */
export const newRunId = (store: EventStore, prefix = ""): string => {
  for (;;) {
    const id = `${prefix}${randomUUID().slice(0, 8)}`;
    if (store.lookup(id).length === 0) return id;
  }
};

export type RunWorkflowResult = {
  exitCode: number;
  result: RunResult | null;
};

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

  const { report, workflow, graph, place, workflowDir } = loadWorkflow(
    options.file,
    options.cwd,
    options.home,
    options.store.projects(),
  );
  if (workflow === null || graph === null) return failed(formatReport(report));

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  // A resumed run keeps its inputs; `--input` changes one.
  const recorded = Object.fromEntries(
    Object.entries(options.resume?.inputs ?? {}).map(([k, v]) => [
      k,
      String(v),
    ]),
  );
  const inputs = resolveInputs(workflow, { ...recorded, ...pairs.raw });
  if (!inputs.ok) return failed(inputs.errors);

  const installed =
    options.installed ??
    (options.tools === undefined ? (p: string) => onPath(p) : () => true);
  const missing = missingPrograms(workflow, installed);
  if (missing.length > 0) return failed(missingProgramMessage(missing));

  const checkout = await prepareCheckout(
    workflow,
    { ...options, cwd: place.root },
    inputs.inputs,
  );
  if (!checkout.ok) return failed(checkout.lines);
  const { root, base } = checkout;
  // Without worktrees nodes work where `ork run` was started, if that is in
  // the project (an attached project's workflow can be run from anywhere).
  const cwd =
    root ?? (inside(place.root, options.cwd) ? options.cwd : place.root);

  const runId = options.runId ?? newRunId(options.store);
  const runDir = runDirOf(place, runId);
  if (options.resume !== undefined) options.store.reopen(runId);
  const record =
    options.resume === undefined
      ? createRecorder(
          options.store,
          {
            id: runId,
            workflow: workflow.name,
            file: path.resolve(options.cwd, options.file),
            project: place.root,
          },
          runDir,
        )
      : appendRecorder(options.store, runId, runDir);
  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const started = Promise.withResolvers<RunHandle>();
  const control = await startControl({
    store: options.store,
    runId,
    emit: event => {
      onEvent(event);
    },
    onStop: () => {
      void (async () => {
        (await started.promise).interrupt();
      })();
    },
    onMessage: (node, body) => {
      void (async () => {
        (await started.promise).tell(node, body);
      })();
    },
    ...(options.human === undefined ? {} : { local: options.human }),
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.intervalMs === undefined
      ? {}
      : { intervalMs: options.intervalMs }),
  });
  // Feedback Ork derives from the run's events is recorded right after them.
  const signals = createSignals(
    feedbackOrigin(path.resolve(options.cwd, options.file)),
  );
  const onEvent = (raw: RunEvent): void => {
    for (const event of signals(raw)) {
      control.publish(record(event));
      if (options.json) options.out(JSON.stringify(event));
      else {
        for (const line of formatRunEvent(event, width, tools)) {
          options.out(line);
        }
      }
    }
  };
  const workspace: Workspace | undefined =
    root === undefined
      ? undefined
      : createWorkspace({
          graph,
          runId,
          root,
          head: base,
          inputs: inputs.inputs,
          onEvent,
          ...(options.resume === undefined
            ? {}
            : {
                adopt: options.resume.worktrees,
                known: options.resume.branches,
              }),
        });

  const executorOptions: Parameters<typeof builtinExecutors>[0] = {
    runtimeFor: options.runtime,
    inPlace: options.inPlace,
  };
  if (options.driver !== undefined) executorOptions.driver = options.driver;
  if (options.tools !== undefined) executorOptions.tools = options.tools;

  const replay =
    options.resume === undefined
      ? undefined
      : createReplay(options.resume.history);
  if (replay !== undefined)
    onEvent({ type: "run.resumed", kept: replay.kept() });
  const handle = startRun({
    graph,
    runId,
    inputs: inputs.inputs,
    cwd,
    executors: builtinExecutors(executorOptions),
    human:
      options.resume === undefined
        ? control.human
        : replayLoopAnswers(control.human, options.resume.loopAnswers),
    onEvent,
    settings: {
      inPlace: options.inPlace,
      ...(options.driver === undefined ? {} : { driver: options.driver }),
    },
    ...(replay === undefined ? {} : { replay }),
    workflowDir,
    projectRoot: root ?? place.root,
    orkDir: place.dir,
    ...(workspace === undefined ? {} : { workspace }),
  });
  started.resolve(handle);
  options.onRun?.(handle);
  const result = await handle.done;
  await control.close();
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
