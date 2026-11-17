/**
 * @file The pieces `ork run` starts a workflow's run with, besides the run
 *   itself: its recorder (a new run's row, or a resumed run's appended to), the
 *   replay of a resumed run, the feedback signals derived from its events, the
 *   built-in executors and what they are told, and the per-run files cleared
 *   around it.
 */

import path from "node:path";

import {
  appendRecorder,
  createRecorder,
  createReplay,
  createSignals,
  type NodeExecutors,
  placeFiles,
  type ProjectPlace,
  type Recorder,
  storePath,
} from "@krapht/ork-core";
import {
  builtinExecutors,
  clearOutputFiles,
  clearStateFiles,
  maskedNamesOfRun,
  onPath,
} from "@krapht/ork-nodes";
import type { Workflow } from "@krapht/ork-schema";

import { feedbackOrigin } from "./origin.ts";
import type { RunWorkflowOptions } from "./workflow-options.ts";

type ExecutorOptions = Parameters<typeof builtinExecutors>[0];

/** The run's recorder: a new run is begun in the store, a resumed one reopened. */
export const recorderOf = (
  options: RunWorkflowOptions,
  run: { id: string; workflow: string; place: ProjectPlace; runDir: string },
): Recorder => {
  if (options.resume !== undefined) {
    options.store.reopen(run.id);
    return appendRecorder(options.store, run.id, run.runDir);
  }
  return createRecorder(
    options.store,
    {
      id: run.id,
      workflow: run.workflow,
      file: path.resolve(options.cwd, options.file),
      project: run.place.root,
      ...(options.calledBy === undefined
        ? {}
        : { parent: options.calledBy.split("/")[0] ?? "" }),
    },
    run.runDir,
  );
};

/** A resumed run's replay of what it kept; none for a new run. */
export const replayOf = (
  options: RunWorkflowOptions,
): ReturnType<typeof createReplay> | undefined =>
  options.resume === undefined
    ? undefined
    : createReplay(
        options.resume.history,
        options.resume.cutOff,
        options.resume.mail,
        options.resume.earlier,
        options.resume.fanOuts,
      );

/** Feedback Ork derives from the run's events, recorded right after them. */
export const signalsOf = (
  options: RunWorkflowOptions,
): ReturnType<typeof createSignals> =>
  createSignals(feedbackOrigin(path.resolve(options.cwd, options.file)));

/**
 * The variables the run masks, and its built-in executors once it is known
 * whether sessions load the machine's Claude settings. `sourceRoot` is the
 * user's checkout when the run works in a worktree of its own: tool nodes get
 * it as `ORK_SOURCE_ROOT`.
 */
export const executorsOf = (
  options: RunWorkflowOptions,
  run: {
    workflow: Workflow;
    place: ProjectPlace;
    projects: readonly ProjectPlace[];
    readyDriver?: ExecutorOptions["readyDriver"];
    sourceRoot?: string;
  },
): {
  maskedNames: string[];
  executors: (machineClaude: boolean) => NodeExecutors;
} => {
  const maskedNames = maskedNamesOfRun(run.workflow, run.place, run.projects);
  const script = process.argv[1];
  const given: ExecutorOptions = {
    runtimeFor: driver => options.runtime(driver, placeFiles(run.place).runs),
    inPlace: options.inPlace,
    maskedNames,
    store: storePath(options.home),
    ...(options.yolo === true ? { yolo: true } : {}),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
    ...(run.readyDriver === undefined ? {} : { readyDriver: run.readyDriver }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(script !== undefined && onPath(script) ? { orkBin: script } : {}),
    ...(run.sourceRoot === undefined ? {} : { sourceRoot: run.sourceRoot }),
  };
  return {
    maskedNames,
    executors: machineClaude => builtinExecutors({ ...given, machineClaude }),
  };
};

/**
 * Clears the run's program output files, and its state files too once it
 * succeeded: a run that didn't may be resumed, and go on from what was kept.
 */
export const clearRunFiles = (
  runDir: string,
  err: (line: string) => void,
  succeeded = false,
): void => {
  clearOutputFiles(runDir, err);
  if (succeeded) clearStateFiles(runDir, err);
};
