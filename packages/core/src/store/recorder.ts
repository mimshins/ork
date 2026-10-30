/**
 * @file Records a run as it happens: each event appended to the store and
 *   copied to the run's `events.jsonl`, both with secrets masked, before
 *   anything else sees it; and adds to a finished run (`ork chat`).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { RunEvent } from "../run/types.ts";
import { maskReplacer } from "./mask.ts";
import type { EventStore, NewRun, StoredEvent } from "./types.ts";

export const EVENTS_FILE = "events.jsonl";

export type Recorder = (event: RunEvent) => StoredEvent;

/**
 * Appends to a run already in the store, e.g. `ork chat` resuming a finished
 * node's session; `runDir` gets the JSONL copy.
 */
export const appendRecorder = (
  store: EventStore,
  runId: string,
  runDir: string,
): Recorder => {
  mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, EVENTS_FILE);
  return event => {
    const stored = store.append(runId, event);
    appendFileSync(file, `${JSON.stringify(stored, maskReplacer)}\n`);
    return stored;
  };
};

/** Begins `run` in the store; `runDir` gets the JSONL copy. */
export const createRecorder = (
  store: EventStore,
  run: NewRun,
  runDir: string,
): Recorder => {
  store.begin(run);
  return appendRecorder(store, run.id, runDir);
};
