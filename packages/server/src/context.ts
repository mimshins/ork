/**
 * @file What the server's handlers share: the store it reads and writes, where
 *   the sockets are, the `ork` script that detached runs start from, and how a
 *   request names a run or a project.
 */

import {
  type EventStore,
  findRun,
  liveStatus,
  type ProjectRecord,
  type RunRecord,
} from "@krapht/ork-core";

import type { RunView } from "./contract.ts";
import { fail } from "./router.ts";

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

/** A run as the API shows it: with its live status. */
export const viewOf = (run: RunRecord): RunView => ({
  ...run,
  live: liveStatus(run),
});
