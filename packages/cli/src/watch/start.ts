/**
 * @file Starting a trigger's run (RFC-011): an ordinary run in the background,
 *   so everything else works on it. It runs the file that was accepted, by its
 *   whole path and only if its text is still what was accepted, so nothing a
 *   branch adds or a pull changes runs in its place. What a check reported
 *   can't become extra arguments: each value is joined to its flag, and its
 *   name must be an input the workflow declares.
 */

import path from "node:path";

import {
  detachRun,
  type EventStore,
  placeFiles,
  type ProjectPlace,
  type StartResult,
} from "@krapht/ork-core";
import type { CheckEvent, Trigger, Workflow } from "@krapht/ork-schema";

/** What a run gets, and which of it came from what the check reported. */
export const inputsFor = (
  trigger: Trigger,
  event: CheckEvent,
): { inputs: Record<string, string>; untrusted: string[] } => {
  const reported = Object.fromEntries(
    Object.entries(event.inputs ?? {}).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
  const own = trigger.inputs ?? {};
  return {
    inputs: { ...reported, ...own },
    untrusted: Object.keys(reported).filter(name => !Object.hasOwn(own, name)),
  };
};

/** How the run is started, with each value joined to its flag. */
export const triggerRunArgs = (options: {
  id: string;
  workflowFile: string;
  workflowHash: string;
  inputs: Readonly<Record<string, string>>;
  untrusted: readonly string[];
  runId: string;
}): string[] => [
  "run",
  options.workflowFile,
  `--expect-workflow=${options.workflowHash}`,
  ...Object.entries(options.inputs).map(
    ([name, value]) => `--input=${name}=${value}`,
  ),
  `--trigger=${options.id}`,
  ...options.untrusted.map(name => `--untrusted=${name}`),
  `--run-id=${options.runId}`,
];

export const startTriggerRun = async (options: {
  store: EventStore;
  place: ProjectPlace;
  id: string;
  trigger: Trigger;
  workflow: Workflow;
  workflowFile: string;
  workflowHash: string;
  event: CheckEvent;
  runId: string;
}): Promise<StartResult> => {
  const { store, place, id, trigger, workflow, event, runId } = options;
  const { workflowFile, workflowHash } = options;
  const { inputs, untrusted } = inputsFor(trigger, event);
  const unknown = Object.keys(inputs).find(
    name => !Object.hasOwn(workflow.inputs ?? {}, name),
  );
  if (unknown !== undefined) {
    return {
      ok: false,
      error: `the check reported input "${unknown}", which ${trigger.run} doesn't declare`,
    };
  }
  const detached = await detachRun({
    store,
    runId,
    cwd: place.root,
    runDir: path.join(placeFiles(place).runs, runId),
    args: triggerRunArgs({
      id,
      workflowFile,
      workflowHash,
      inputs,
      untrusted,
      runId,
    }),
  });
  return detached.ok ? { ok: true } : { ok: false, error: detached.error };
};
