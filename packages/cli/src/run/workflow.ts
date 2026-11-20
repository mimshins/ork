/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run. `ork resume` comes through here too, with the
 *   run's recorded state.
 */

import {
  createWorkspace,
  endHeartbeat,
  endLinksOf,
  loadProject,
  machineRulesOf,
  machineLockLedgers,
  machineSlotLedger,
  newRunId,
  parseInputPairs,
  replayLoopAnswers,
  resolveInputs,
  resumedOptions,
  placeFiles,
  runDirOf,
  type RunEvent,
  type RunHandle,
  type RunResult,
  type RunRoot,
  runRootEvent,
  runScrubber,
  startControl,
  startRun,
  walkSummary,
  type Workspace,
} from "@krapht/ork-core";

import {
  formatReport,
  loadWorkflow,
  walkLoaded,
  warningLines,
} from "../commands/validate.ts";
import { callPorts } from "./calls.ts";
import { createView, formatRunEvent } from "./format.ts";
import {
  liveControl,
  liveHandlers,
  takeLastCommands,
} from "./live-handlers.ts";
import { alwaysOptions, ORK_RUN_VERSION, signalsOf } from "./origin.ts";
import { preflight } from "./preflight.ts";
import {
  closeRunRoot,
  openRunRootFor,
  seededGraph,
  seedFor,
  seedOf,
} from "./run-root.ts";
import {
  clearRunFiles,
  executorsOf,
  nodesCwd,
  recordedInputs,
  recorderOf,
  replayOf,
} from "./run-setup.ts";
import type { RunWorkflowOptions } from "./workflow-options.ts";

export type { RunWorkflowOptions };

export type RunWorkflowResult = {
  exitCode: number;
  result: RunResult | null;
};

/**
 * Runs a whole workflow: checks it and its inputs, then hands the compiled
 * graph to the scheduler with the built-in node types, and streams the run. The
 * run's own root, when it needs one, is opened first (the check finds the
 * bundle there) and closed however the run ends.
 */
export const runWorkflowFile = async (
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> => {
  const runId = options.runId ?? newRunId(options.store);
  const opened = await openRunRootFor(options, runId);
  if (!opened.ok) {
    options.err(opened.error);
    return { exitCode: 1, result: null };
  }
  try {
    return await runIn(options, runId, opened.root);
  } finally {
    // A second close is no error: the end of a started run closed it first.
    await closeRunRoot(opened.root, options.err);
  }
};

const runIn = async (
  options: RunWorkflowOptions,
  runId: string,
  runRoot: RunRoot | undefined,
): Promise<RunWorkflowResult> => {
  const failed = (lines: string[]): RunWorkflowResult => {
    for (const line of lines) options.err(line);
    return { exitCode: 1, result: null };
  };

  const loaded = loadWorkflow(
    options.file,
    options.cwd,
    options.home,
    options.store.projects(),
    runRoot?.path,
  );
  const { workflow, place, workflowDir, textHash } = loaded;
  const seed = seedOf(options);
  const graph = seededGraph(loaded.graph, seed);
  if (
    options.expectWorkflow !== undefined &&
    options.expectWorkflow !== textHash
  ) {
    return failed([
      `${options.file} isn't what was accepted: it changed after ork watch read it. Accept it again with \`ork watch --accept\`.`,
    ]);
  }
  if (workflow === null || graph === null) {
    return failed(formatReport(loaded.report));
  }
  // A resumed run was walked when it started, and said so then.
  const { report } =
    options.resume === undefined ? await walkLoaded(loaded) : loaded;
  for (const line of warningLines(report)) options.err(line);
  // No finding could mean a clean walk, or one that stopped too early to say.
  if (report.walk?.complete === false) options.err(walkSummary(report.walk));

  const pairs = parseInputPairs(options.inputs);
  if (!pairs.ok) return failed([`--input: ${pairs.error}`]);
  const recorded = recordedInputs(options);
  const inputs = resolveInputs(workflow, { ...recorded, ...pairs.raw });
  if (!inputs.ok) return failed(inputs.errors);

  const projects = options.store.projects();
  const ready = await preflight(options, {
    workflow,
    effective: graph.workflow,
    place,
    projects,
    inputs: inputs.inputs,
    runRoot: runRoot !== undefined,
  });
  if (!ready.ok) return failed(ready.lines);
  const { root, base } = ready;
  const cwd = nodesCwd(options.cwd, place, { runRoot: runRoot?.path, root });

  const runDir = runDirOf(place, runId);
  const record = recorderOf(options, {
    id: runId,
    workflow: workflow.name,
    place,
    runDir,
  });
  // Recorded: a detached start's wait is over.
  endHeartbeat();
  const width = Math.max(...Object.keys(workflow.nodes).map(id => id.length));
  const tools = new Map<string, string>();
  const view = createView();
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
    ...(options.yolo === true ? { yolo: true } : {}),
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.intervalMs === undefined
      ? {}
      : { intervalMs: options.intervalMs }),
    ...alwaysOptions(place, options.err),
  });
  const signals = signalsOf(options, workflow, place);
  const onEvent = (raw: RunEvent): void => {
    for (const event of signals(raw)) {
      control.publish(record(event));
      if (options.json) options.out(JSON.stringify(event));
      else {
        for (const line of formatRunEvent(
          event,
          width,
          tools,
          options.human !== undefined,
          options.verbose,
          view,
        )) {
          options.out(line);
        }
      }
    }
  };
  // What this run's worktrees start from; recorded, so a resume reuses it.
  const head = runRoot?.base ?? base;
  const workspace: Workspace | undefined =
    root === undefined
      ? undefined
      : createWorkspace({
          graph,
          runId,
          root: runRoot?.path ?? root,
          head,
          inputs: inputs.inputs,
          onEvent,
          runRoot: runRoot !== undefined,
          ...resumedOptions(options.resume),
          ...seedFor(seed, place.root),
        });
  const { maskedNames, executors } = executorsOf(options, {
    workflow,
    place,
    projects,
    ...(ready.readyDriver === undefined
      ? {}
      : { readyDriver: ready.readyDriver }),
    ...(runRoot === undefined ? {} : { sourceRoot: runRoot.source }),
  });
  const replay = replayOf(options);
  const writeOnly = options.writeOnly ?? options.resume?.settings.writeOnly;
  if (replay !== undefined)
    onEvent({ type: "run.resumed", kept: replay.kept(), ork: ORK_RUN_VERSION });
  // Recorded, so `ork worktrees` and clean find a crash's leftover by its run.
  if (runRoot !== undefined) onEvent(runRootEvent(runRoot, "created"));
  const ports = callPorts({
    ...options,
    graph,
    runId,
    place,
    human: control.human,
    emit: onEvent,
  });
  clearRunFiles(runDir, options.err);
  const handle = startRun({
    graph: ports.graph,
    calls: ports.calls,
    runId,
    runDir,
    inputs: inputs.inputs,
    cwd,
    // Recorded with the run, so a resume and its called runs load it too.
    executors: executors(ports.settings.machineClaude === true),
    human:
      options.resume === undefined
        ? control.human
        : replayLoopAnswers(control.human, options.resume.loopAnswers),
    onEvent,
    orkVersion: ORK_RUN_VERSION,
    settings: {
      inPlace: options.inPlace,
      ...(options.driver === undefined ? {} : { driver: options.driver }),
      ...(ready.readyDriver === undefined
        ? {}
        : { readyDriver: ready.readyDriver }),
      ...ports.settings,
      ...(head === "" ? {} : { baseRef: head }),
      ...(writeOnly === undefined ? {} : { writeOnly }),
      ...(seed === undefined ? {} : { seed }),
    },
    followUps: ports.followUps,
    ...(ports.relay === undefined ? {} : { relay: ports.relay }),
    ...(replay === undefined ? {} : { replay }),
    workflowDir,
    projectRoot: runRoot?.path ?? root ?? place.root,
    orkDir: place.dir,
    ...(workspace === undefined ? {} : { workspace }),
    scrub: runScrubber(maskedNames, process.env),
    limits: ready.limits,
    machine: {
      rules: machineRulesOf(
        loadProject(place.root, placeFiles(place).rules).project,
      ),
      ledger: machineSlotLedger(
        options.home === undefined ? {} : { home: options.home },
      ),
    },
    locks: machineLockLedgers(root ?? place.root, place.root, options.home),
    beforeFinish: takeLastCommands(control, started.promise),
  });
  live.handle = handle;
  started.resolve(handle);
  options.onRun?.(handle);
  const result = await handle.done;
  await ports.shown.end(result.status);
  clearRunFiles(runDir, options.err, result.status === "succeeded");
  await endLinksOf(options.store, runId, result.status, options.home);
  await closeRunRoot(runRoot, options.err, onEvent);
  await control.close();
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
