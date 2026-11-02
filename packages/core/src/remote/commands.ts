/**
 * @file Commands to a live run from another process (`ork stop`, `ork chat`,
 *   the local server): each is a row in the store, then a wake on the run's
 *   socket so the run acts at once instead of at its next poll
 *   (specs/messaging.md#reaching-a-live-run).
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import type { EventStore, RunRecord } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";

export type Commanded =
  | { ok: true; woke: boolean }
  | { ok: false; error: string };

/** Sends a live run's node a message; false when the run did not wake. */
export const tellLiveRun = (
  store: EventStore,
  run: RunRecord,
  node: string,
  body: string,
  home?: string,
): Promise<boolean> => {
  store.command(run.id, { kind: "message", node, body });
  return wakeRun(socketPath(run.id, home));
};

/**
 * Asks a live run to stop. The run finishes its running nodes first, so it may
 * still be running when this returns.
 */
export const requestStop = async (
  store: EventStore,
  run: RunRecord,
  home?: string,
): Promise<Commanded> => {
  const status = liveStatus(run);
  if (status !== "running") {
    return { ok: false, error: `Run ${run.id} is not running (${status}).` };
  }
  store.command(run.id, { kind: "stop" });
  return { ok: true, woke: await wakeRun(socketPath(run.id, home)) };
};
