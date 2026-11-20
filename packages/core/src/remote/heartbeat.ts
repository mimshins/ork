/**
 * @file The sign of life a detached `ork run` or `ork resume` gives while it
 *   starts: it touches a file (named by `ORK_HEARTBEAT_FILE`, in the run's
 *   folder) every second until its run is recorded, and `detachRun` waits for
 *   it as long as the file stays fresh. The file is left in place; it holds
 *   nothing.
 */

import { writeFileSync } from "node:fs";

/** Set in a detached child's environment: the file it touches while starting. */
export const HEARTBEAT_ENV = "ORK_HEARTBEAT_FILE";

let timer: NodeJS.Timeout | undefined;

const touch = (file: string): void => {
  try {
    writeFileSync(file, "");
  } catch {
    // A missing folder only means no beat; the parent's deadline still holds.
  }
};

/**
 * Touches `file` now and every `everyMs` until `endHeartbeat`; does nothing
 * without a file. The timer never keeps the process up.
 */
export const beginHeartbeat = (
  file = process.env[HEARTBEAT_ENV],
  everyMs = 1000,
): void => {
  if (file === undefined || file === "") return;
  endHeartbeat();
  touch(file);
  timer = setInterval(() => {
    touch(file);
  }, everyMs);
  timer.unref();
};

/** Stops the beat (once the run is recorded); the file stays. */
export const endHeartbeat = (): void => {
  clearInterval(timer);
  timer = undefined;
};
