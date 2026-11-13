/**
 * @file What the server's handlers share: the store it reads and writes, where
 *   the sockets are, the `ork` script that detached runs start from, and how a
 *   request names a run or a project.
 */

import {
  type EventStore,
  findRun,
  type GhRunner,
  outputsText,
  pausedOf,
  type ProjectRecord,
  type RunRecord,
  runStatus,
} from "@krapht/ork-core";

import type { RunView } from "./contract.ts";
import { fail } from "./router.ts";
import type { Updates } from "./updates.ts";

export type ServerContext = {
  store: EventStore;
  /** `~`, where the sockets are; tests pass a folder. */
  home?: string;
  version: string;
  pid: number;
  startedAt: string;
  /** The `ork` script detached runs start (default: the running one). */
  script?: string;
  /** The built UI's folder; without one the placeholder page is served. */
  uiDir?: string;
  /**
   * Runs `gh` for publishing feedback (default: the real one); tests pass their
   * own.
   */
  gh?: GhRunner;
  /** The record of versions, the daily check, and the one upgrade. */
  updates: Updates;
  /** Restarts `ork ui` onto the installed `ork`, when `ork ui` started it. */
  restart?: () => void;
};

type Refusal = { status: 400 | 404 | 409; error: string };

/** A run by id or unique prefix: 404 when there is none, 400 when several. */
export const runOf = (
  context: ServerContext,
  id: string,
): { ok: true; run: RunRecord } | { ok: false; refusal: Refusal } => {
  const found = findRun(context.store, id, "");
  if (found.ok) return found;
  const status = context.store.lookup(id).length === 0 ? 404 : 400;
  return { ok: false, refusal: fail(status, found.error) };
};

/** A registered project by id or root. */
export const projectOf = (
  context: ServerContext,
  key: string,
): ProjectRecord | undefined =>
  context.store.projects().find(p => p.id === key || p.root === key);

/** A run as the API shows it: with its live status and what is paused. */
export const viewOf = (context: ServerContext, run: RunRecord): RunView => {
  // Only a running run can be paused; its other events are not read.
  const events =
    run.status === "running"
      ? context.store.controlEvents(run.id).map(stored => stored.event)
      : [];
  return { ...run, live: runStatus(run, events), paused: pausedOf(events) };
};

/** The run's view plus its last finish's declared outputs, when it has any. */
export const viewWithOutputs = (
  context: ServerContext,
  run: RunRecord,
): RunView => {
  const finished = context.store
    .controlEvents(run.id)
    .map(stored => stored.event)
    .findLast(event => event.type === "run.finished");
  const outputs = outputsText(
    finished?.type === "run.finished" ? finished.result.outputs : undefined,
  );
  return {
    ...viewOf(context, run),
    ...(outputs.length === 0 ? {} : { outputs }),
  };
};
