/**
 * @file Whether a stored run can be resumed, and with what: its recorded state,
 *   and the flags it was started with unless the user changes them.
 */

import {
  type EventStore,
  liveStatus,
  type ResumeState,
  resumeState,
  type RunRecord,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

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
