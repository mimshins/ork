/**
 * @file Where a run's feedback comes from, beyond what its events say: Ork's
 *   version (bound from the CLI's `package.json`) and the workflow file's
 *   content hash; and the feedback and `follow_up` ports of the one node `ork
 *   run --node` runs.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  type CompiledGraph,
  createFeedback,
  createFollowUps,
  type EventStore,
  type FeedbackPort,
  type FollowUpPort,
  type ProjectPlace,
  type RunEvent,
  runScrubber,
  type SignalOptions,
} from "@krapht/ork-core";
import { maskedNamesOfRun } from "@krapht/ork-nodes";
import type { Workflow } from "@krapht/ork-schema";

import { ORK_VERSION } from "../__build_info__.ts";
import { followUpSink } from "../follow-ups/context.ts";

/** Ork's version and the workflow's hash, for the run's feedback records. */
/** The Ork version a run records in `run.started` and `run.resumed`. */
export const ORK_RUN_VERSION: string = ORK_VERSION;

export const feedbackOrigin = (workflowFile: string): SignalOptions => {
  const origin: SignalOptions = { version: ORK_VERSION };
  try {
    origin.workflowHash = createHash("sha256")
      .update(readFileSync(workflowFile))
      .digest("hex")
      .slice(0, 12);
  } catch {
    // The run reports a missing file itself.
  }
  return origin;
};

/**
 * Node `id`'s feedback port (with a graph) and `follow_up` port, kept as the
 * project's rule says; both mask the values of what its run masks.
 */
export const nodeReports = (
  options: {
    store: EventStore;
    place: ProjectPlace;
    home?: string | undefined;
    runId: string;
    id: string;
    cwd: string;
  },
  {
    workflow,
    graph,
    record,
  }: {
    workflow: Workflow;
    graph: CompiledGraph | null;
    record: (event: RunEvent) => void;
  },
): { feedback?: FeedbackPort; followUps: FollowUpPort } => {
  const { place, id } = options;
  const scrub = runScrubber(
    maskedNamesOfRun(workflow, place, options.store.projects()),
    process.env,
  );
  const sink = followUpSink(options);
  return {
    ...(graph === null
      ? {}
      : {
          feedback: createFeedback({ graph, onEvent: record, scrub }).port(id),
        }),
    followUps: createFollowUps({ runId: options.runId, sink, scrub }).port(
      id,
      options.cwd,
    ),
  };
};
