/**
 * @file Whether a stored run can be resumed, and with what: its recorded state,
 *   and the flags it was started with unless the user changes them; and
 *   resuming it in the background (`ork resume --detach`, the local server).
 */

import path from "node:path";

import type { Driver } from "@krapht/ork-schema";

import { placeFor, runDirOf } from "../project/place.ts";
import { type ResumeState, resumeState } from "../run/resume.ts";
import type { EventStore, RunRecord } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { type Detached, detachRun } from "./detach.ts";

export type Resumable =
  | { ok: true; state: ResumeState; inPlace: boolean; driver?: Driver }
  | { ok: false; error: string };

/** A run `ork resume` can continue: not running, not done, of a workflow. */
export const resumable = (
  store: EventStore,
  run: RunRecord,
  flags: { inPlace?: boolean; driver?: Driver },
): Resumable => {
  const status = liveStatus(run);
  if (status === "running") {
    return { ok: false, error: `Run ${run.id} is still running.` };
  }
  const events = store.events(run.id, 0).map(stored => stored.event);
  const state = resumeState(events);
  if (state.succeeded) {
    return {
      ok: false,
      error: `Run ${run.id} succeeded; there is nothing to resume.`,
    };
  }
  if (run.id.startsWith("node-")) {
    return {
      ok: false,
      error: `Run ${run.id} ran one node; run it again with ork run --node.`,
    };
  }
  const driver = flags.driver ?? state.settings.driver;
  return {
    ok: true,
    state,
    inPlace: flags.inPlace ?? state.settings.inPlace ?? false,
    ...(driver === undefined ? {} : { driver }),
  };
};

/** The folder of a stored run, in the project its workflow file is in. */
export const storedRunDir = (store: EventStore, run: RunRecord): string =>
  runDirOf(
    placeFor(
      path.dirname(path.resolve(run.project, run.file)),
      store.projects(),
    ),
    run.id,
  );

/**
 * Resumes `run` in a background process with the given `ork resume` flags, and
 * returns once it is running again.
 */
export const detachResume = (
  store: EventStore,
  run: RunRecord,
  flags: readonly string[],
  script?: string,
): Promise<Detached> =>
  detachRun({
    store,
    runId: run.id,
    args: ["resume", run.id, ...flags],
    cwd: run.project,
    runDir: storedRunDir(store, run),
    ...(script === undefined ? {} : { script }),
    // Resuming records the run as the new process's, even if it ends at once.
    started: pid => store.lookup(run.id)[0]?.pid === pid,
  });
