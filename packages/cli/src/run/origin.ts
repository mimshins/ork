/**
 * @file Where a run's feedback comes from, beyond what its events say: Ork's
 *   version (bound from the CLI's `package.json`) and the workflow file's
 *   content hash; and the `follow_up` port of the one node `ork run --node`
 *   runs.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  createFollowUps,
  type EventStore,
  type FollowUpPort,
  type ProjectPlace,
  type SignalOptions,
} from "@krapht/ork-core";

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

/** The `follow_up` port of node `id`, kept as the project's rule says. */
export const nodeFollowUps = (options: {
  store: EventStore;
  place: ProjectPlace;
  home?: string | undefined;
  runId: string;
  id: string;
  cwd: string;
}): FollowUpPort =>
  createFollowUps({ runId: options.runId, sink: followUpSink(options) }).port(
    options.id,
    options.cwd,
  );
