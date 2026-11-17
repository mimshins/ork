/**
 * @file What a person left of `ork onboard` (specs/cli/onboard-saved.md), read
 *   from the store alone: the newest `ork:onboard-propose` run of this project
 *   that no `ork:onboard-write` run followed decides. Succeeded, it is a saved
 *   proposal: its `survey` and `answers` come from the run's `run.started`
 *   inputs and its suggestions from the `propose` node's output in
 *   `run.finished`, checked again against the files as they are now. Not
 *   succeeded, it is an unfinished proposal when `ork resume` could continue
 *   it. Nothing is written for either.
 */

import {
  type EventStore,
  liveStatus,
  type ResumeState,
  resumable,
  type RunEvent,
  type RunRecord,
} from "@krapht/ork-core";

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

export type UnfinishedProposal = {
  run: RunRecord;
  /** When the propose run started. */
  at: string;
  /** How it ended, `crashed` for a run whose process is gone. */
  status: string;
  /** Its inputs as the store holds them (masked). */
  survey: string;
  answers: string;
  /** What `ork resume` continues it from. */
  resume: ResumeState;
};

/** The newest propose run of the project that no write run followed. */
const newestPropose = (
  store: EventStore,
  root: string,
): { run: RunRecord; events: RunEvent[] } | null => {
  // `store.runs` lists the newest run first.
  const runs = store.runs({ project: root }).filter(r => isBuiltinRun(r));
  const run = runs.find(r => r.workflow === PROPOSED);
  if (run === undefined) return null;
  if (runs.some(r => r.workflow === WRITTEN && r.startedAt >= run.startedAt)) {
    return null;
  }
  return { run, events: store.events(run.id).map(stored => stored.event) };
};

/** The run's `survey` and `answers` inputs, or `null` when either is not text. */
const inputsOf = (
  events: readonly RunEvent[],
): { survey: string; answers: string } | null => {
  const started = events.find(event => event.type === "run.started");
  if (started?.type !== "run.started") return null;
  const survey = started.inputs?.["survey"];
  const answers = started.inputs?.["answers"];
  return typeof survey === "string" && typeof answers === "string"
    ? { survey, answers }
    : null;
};

/**
 * The saved proposal of the project at `root` (its registered root), or `null`
 * when the newest propose run did not succeed, a write run followed it, its
 * record is incomplete, or no suggestion of it survives today's checks.
 */
export const findSavedProposal = (
  store: EventStore,
  root: string,
): SavedProposal | null => {
  const newest = newestPropose(store, root);
  if (newest?.run.status !== "succeeded") return null;
  const { run, events } = newest;
  const finished = events.findLast(event => event.type === "run.finished");
  const inputs = inputsOf(events);
  if (finished?.type !== "run.finished" || inputs === null) return null;
  const proposed = proposedOf(finished.result, root);
  return proposed.kept.length === 0
    ? null
    : { run, at: run.startedAt, ...inputs, proposed };
};

/**
 * The unfinished proposal of the project at `root`, or `null` when the newest
 * propose run succeeded, is still running, used its budget, a write run
 * followed it, its inputs are not text, or `ork resume` would refuse it.
 */
export const findUnfinishedPropose = (
  store: EventStore,
  root: string,
): UnfinishedProposal | null => {
  const newest = newestPropose(store, root);
  // A resumed run's budget counts what it spent, and the built-in's cap can't be raised.
  const done = ["succeeded", "budget_exhausted"];
  if (newest === null || done.includes(newest.run.status)) return null;
  const { run, events } = newest;
  const inputs = inputsOf(events);
  const ready = resumable(store, run, {});
  if (inputs === null || !ready.ok) return null;
  return {
    run,
    at: run.startedAt,
    status: liveStatus(run),
    ...inputs,
    resume: ready.state,
  };
};
