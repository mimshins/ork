/**
 * @file `ork run` for a whole workflow: checks the workflow, its inputs and the
 *   project (git, uncommitted agent files), sets up the worktree workspace, and
 *   streams the scheduler's run. `ork resume` comes through here too, with the
 *   run's recorded state.
 */

import path from "node:path";

import {
  appendRecorder,
  createRecorder,
  createReplay,
  createSignals,
  createWorkspace,
  endLinksOf,
  inside,
  newRunId,
  parseInputPairs,
  replayLoopAnswers,
  resolveInputs,
  runDirOf,
  type RunEvent,
  type RunHandle,
  type RunResult,
  startControl,
  startRun,
  walkSummary,
  type Workspace,
} from "@krapht/ork-core";
import {
  builtinExecutors,
  clearOutputFiles,
  clearStateFiles,
  maskedNamesOfRun,
  onPath,
  runScrubber,
} from "@krapht/ork-nodes";

import {
  formatReport,
  loadWorkflow,
  walkLoaded,
  warningLines,
} from "../commands/validate.ts";
import { callPorts } from "./calls.ts";
import { formatRunEvent } from "./format.ts";
import {
  liveControl,
  liveHandlers,
  takeLastCommands,
} from "./live-handlers.ts";
import { feedbackOrigin } from "./origin.ts";
import { preflight } from "./preflight.ts";
import type { RunWorkflowOptions } from "./workflow-options.ts";

export type { RunWorkflowOptions };

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

  const loaded = loadWorkflow(
    options.file,
    options.cwd,
    options.home,
    options.store.projects(),
  );
  const { workflow, graph, place, workflowDir, textHash } = loaded;
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
  // A resumed run keeps its inputs; `--input` changes one.
  const recorded = Object.fromEntries(
    Object.entries(options.resume?.inputs ?? {}).map(([k, v]) => [
      k,
      String(v),
    ]),
  );
  const inputs = resolveInputs(workflow, { ...recorded, ...pairs.raw });
  if (!inputs.ok) return failed(inputs.errors);

  const projects = options.store.projects();
  const ready = await preflight(options, {
    workflow,
    effective: graph.workflow,
    place,
    projects,
    inputs: inputs.inputs,
  });
  if (!ready.ok) return failed(ready.lines);
  const { root, base } = ready;
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
        for (const line of formatRunEvent(
          event,
          width,
          tools,
          options.human !== undefined,
        )) {
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
  if (ready.readyDriver !== undefined) {
    executorOptions.readyDriver = ready.readyDriver;
  }
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
          options.resume.fanOuts,
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
  // Recorded with the run, so a resume and its called runs load it too.
  if (ports.settings.machineClaude === true) {
    executorOptions.machineClaude = true;
  }
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
      ...(ready.readyDriver === undefined
        ? {}
        : { readyDriver: ready.readyDriver }),
      ...ports.settings,
    },
    ...(ports.relay === undefined ? {} : { relay: ports.relay }),
    ...(replay === undefined ? {} : { replay }),
    workflowDir,
    projectRoot: root ?? place.root,
    orkDir: place.dir,
    ...(workspace === undefined ? {} : { workspace }),
    scrub: runScrubber(maskedNames, process.env),
    limits: ready.limits,
    beforeFinish: takeLastCommands(control, started.promise),
  });
  live.handle = handle;
  started.resolve(handle);
  options.onRun?.(handle);
  const result = await handle.done;
  clearOutputFiles(runDir, options.err);
  // A run that didn't succeed may be resumed, and go on from what was kept.
  if (result.status === "succeeded") clearStateFiles(runDir, options.err);
  await endLinksOf(options.store, runId, result.status, options.home);
  await control.close();
  return { exitCode: result.status === "succeeded" ? 0 : 1, result };
};
