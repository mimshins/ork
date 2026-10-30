/**
 * @file Records a run as it happens: each event appended to the store and
 *   copied to the run's `events.jsonl`, both with secrets masked, before
 *   anything else sees it.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { RunEvent } from "../run/types.ts";
import { maskReplacer } from "./mask.ts";
import type { EventStore, NewRun, StoredEvent } from "./types.ts";

export const EVENTS_FILE = "events.jsonl";

export type Recorder = (event: RunEvent) => StoredEvent;

/** Begins `run` in the store; `runDir` gets the JSONL copy. */
export const createRecorder = (
  store: EventStore,
  run: NewRun,
  runDir: string,
): Recorder => {
  store.begin(run);
  mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, EVENTS_FILE);
  return event => {
    const stored = store.append(run.id, event);
    appendFileSync(file, `${JSON.stringify(stored, maskReplacer)}\n`);
    return stored;
  };
};
