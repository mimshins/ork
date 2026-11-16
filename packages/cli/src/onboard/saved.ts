/**
 * @file The proposal a person left at the pick (specs/cli/onboard-flow.md
 *   #a-saved-proposal): the newest succeeded `ork:onboard-propose` run of this
 *   project that no `ork:onboard-write` run followed, read from the store
 *   alone. Its `survey` and `answers` come from the run's `run.started` inputs
 *   and its suggestions from the `propose` node's output in `run.finished`,
 *   checked again against the files as they are now. Nothing is written for
 *   it.
 */

import type { EventStore, RunRecord } from "@krapht/ork-core";

import { isBuiltinRun } from "./history.ts";
import { type Proposed, proposedOf } from "./pick.ts";

/** The built-ins' workflow names as the store records them. */
const PROPOSED = "ork-onboard-propose";
const WRITTEN = "ork-onboard-write";

export type SavedProposal = {
  run: RunRecord;
  /** When the propose run started. */
  at: string;
  survey: string;
  answers: string;
  /** What still holds today; never empty. */
  proposed: Proposed;
};

/**
 * The saved proposal of the project at `root` (its registered root), or `null`
 * when there is none, a write run followed it, its record is incomplete, or no
 * suggestion of it survives today's checks.
 */
export const findSavedProposal = (
  store: EventStore,
  root: string,
): SavedProposal | null => {
  const runs = store.runs({ project: root }).filter(r => isBuiltinRun(r));
  const run = runs.find(
    r => r.workflow === PROPOSED && r.status === "succeeded",
  );
  if (run === undefined) return null;
  if (runs.some(r => r.workflow === WRITTEN && r.startedAt >= run.startedAt)) {
    return null;
  }
  const events = store.events(run.id).map(stored => stored.event);
  const started = events.find(event => event.type === "run.started");
  const finished = events.findLast(event => event.type === "run.finished");
  if (started?.type !== "run.started" || finished?.type !== "run.finished") {
    return null;
  }
  const survey = started.inputs?.["survey"];
  const answers = started.inputs?.["answers"];
  if (typeof survey !== "string" || typeof answers !== "string") return null;
  const proposed = proposedOf(finished.result, root);
  return proposed.kept.length === 0
    ? null
    : { run, at: run.startedAt, survey, answers, proposed };
};
