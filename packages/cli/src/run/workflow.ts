/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run. `ork resume` comes through here too, with the
 *   run's recorded state.
 */

import path from "node:path";

import {
  appendRecorder,
  type ClaudeRuntime,
  createRecorder,
  createReplay,
  createSignals,
  createWorkspace,
  endLinksOf,
  type EventStore,
  type HumanChannel,
  inside,
  newRunId,
  parseInputPairs,
  replayLoopAnswers,
  resolveInputs,
  type ResumeState,
  runDirOf,
  type RunEvent,
  type RunHandle,
  type RunResult,
  startControl,
  startRun,
  type Workspace,
} from "@krapht/ork-core";
import {
  builtinExecutors,
  clearOutputFiles,
  envProblems,
  maskedNamesOfRun,
  missingProgramMessage,
  missingPrograms,
  onPath,
  runScrubber,
  type ToolRunner,
} from "@krapht/ork-nodes";
import type { Driver } from "@krapht/ork-schema";

import { formatReport, loadWorkflow } from "../commands/validate.ts";
import { callPorts } from "./calls.ts";
import { prepareCheckout } from "./checkout.ts";
import { formatRunEvent } from "./format.ts";
import {
  liveControl,
  liveHandlers,
  takeLastCommands,
} from "./live-handlers.ts";
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
  /** The `workflow.call` that started this run, as `<run>/<node>` (RFC-004). */
  calledBy?: string;
  /** What the caller has left of its budget, which caps this run's. */
  budgetCap?: number;
  /** What this run's worktrees start from, instead of the project's `HEAD`. */
  baseRef?: string;
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
  const projects = options.store.projects();
  const history = options.resume?.history;
  const unset = envProblems(workflow, place, projects, history, options.err);
  if (unset.length > 0) return failed(unset);

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
            ...(options.calledBy === undefined
              ? {}
              : { parent: options.calledBy.split("/")[0] ?? "" }),
          },
          runDir,
        )
      : appendRecorder(options.store, runId, runDir);
  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const started = Promise.withResolvers<RunHandle>();
  // The handle, once the run has started: pause and stop act on it at once.
  const live: { handle?: RunHandle } = {};
  const control = await startControl({
    store: options.store,
    runId,
    emit: event => {
      onEvent(event);
    },
    ...liveHandlers(started.promise),
    onControl: liveControl(live),
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
          head: options.baseRef ?? options.resume?.settings.baseRef ?? base,
          inputs: inputs.inputs,
          onEvent,
          ...(options.resume === undefined
            ? {}
            : {
                adopt: options.resume.worktrees,
                known: options.resume.branches,
              }),
        });

  const maskedNames = maskedNamesOfRun(workflow, place, projects);
  const executorOptions: Parameters<typeof builtinExecutors>[0] = {
    runtimeFor: options.runtime,
    inPlace: options.inPlace,
    maskedNames,
  };
  if (options.driver !== undefined) executorOptions.driver = options.driver;
  if (options.tools !== undefined) executorOptions.tools = options.tools;
  const script = process.argv[1];
  if (script !== undefined && onPath(script)) executorOptions.orkBin = script;

  const replay =
    options.resume === undefined
      ? undefined
      : createReplay(
          options.resume.history,
          options.resume.cutOff,
          options.resume.mail,
          options.resume.earlier,
        );
  if (replay !== undefined)
    onEvent({ type: "run.resumed", kept: replay.kept() });
  const ports = callPorts({
    ...options,
    graph,
    runId,
    place,
    human: control.human,
    emit: onEvent,
  });
  clearOutputFiles(runDir, options.err);
  const handle = startRun({
    graph: ports.graph,
    calls: ports.calls,
    runId,
    runDir,
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
      ...ports.settings,
    },
    ...(ports.relay === undefined ? {} : { relay: ports.relay }),
    ...(replay === undefined ? {} : { replay }),
    workflowDir,
    projectRoot: root ?? place.root,
    orkDir: place.dir,
    ...(workspace === undefined ? {} : { workspace }),
    scrub: runScrubber(maskedNames, process.env),
    beforeFinish: takeLastCommands(control, started.promise),
  });
  live.handle = handle;
  started.resolve(handle);
  options.onRun?.(handle);
  const result = await handle.done;
  clearOutputFiles(runDir, options.err);
  await endLinksOf(options.store, runId, result.status, options.home);
  await control.close();
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
