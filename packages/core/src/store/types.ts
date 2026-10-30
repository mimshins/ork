/**
 * @file The event store's port (specs/event-store.md): every run's record and
 *   its append-only events, read back by `ork ps`, `logs` and `tree` and, in
 *   M2, by the server.
 */

import type { RunEvent, RunStatus } from "../run/types.ts";

/** A run's status in the store: `running` until `run.finished` is written. */
export type StoredRunStatus = RunStatus | "running";

export type RunRecord = {
  id: string;
  workflow: string;
  /** The workflow file, absolute. */
  file: string;
  /** The project root the run started in, absolute. */
  project: string;
  status: StoredRunStatus;
  /** The process that runs it; a `running` run whose process is gone crashed. */
  pid: number;
  startedAt: string;
  finishedAt?: string;
  costUsd: number;
};

export type NewRun = Pick<RunRecord, "id" | "workflow" | "file" | "project">;

export type StoredEvent = {
  runId: string;
  /** 1, 2, 3, … within the run. */
  seq: number;
  /** ISO time it was written. */
  at: string;
  event: RunEvent;
};

export type EventStore = {
  /** Records a new run as `running` in this process. */
  begin: (run: NewRun) => RunRecord;
  /** Appends one event; `run.finished` also settles the run's record. */
  append: (runId: string, event: RunEvent) => StoredEvent;
  /** Runs, newest first; only one project's when given. */
  runs: (filter?: { project?: string; limit?: number }) => RunRecord[];
  /** The runs whose id starts with `prefix` (the whole id matches one). */
  lookup: (prefix: string) => RunRecord[];
  /** A run's events in order, after `seq` when given. */
  events: (runId: string, after?: number) => StoredEvent[];
  close: () => void;
};
