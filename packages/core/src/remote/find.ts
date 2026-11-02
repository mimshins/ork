/**
 * @file Finding a stored run from another process: by a run id or a unique
 *   prefix of one, or, with none, the newest run of the project a folder is in;
 *   and picking a new run's id. Shared by the CLI's commands and the local
 *   server (ADR-039).
 */

import { randomUUID } from "node:crypto";

import { placeFor } from "../project/place.ts";
import type { EventStore, RunRecord } from "../store/types.ts";

export type FoundRun =
  | { ok: true; run: RunRecord }
  | { ok: false; error: string };

/** The run `arg` names, or the newest run of the project `cwd` is in. */
export const findRun = (
  store: EventStore,
  arg: string | undefined,
  cwd: string,
): FoundRun => {
  if (arg === undefined || arg === "") {
    const [latest] = store.runs({
      project: placeFor(cwd, store.projects()).root,
      limit: 1,
    });
    return latest === undefined
      ? { ok: false, error: "No runs in this project yet; see `ork ps --all`." }
      : { ok: true, run: latest };
  }
  const found = store.lookup(arg);
  const [only] = found;
  if (only === undefined) return { ok: false, error: `No run "${arg}".` };
  if (found.length > 1) {
    return {
      ok: false,
      error: `"${arg}" matches ${String(found.length)} runs: ${found.map(r => r.id).join(", ")}`,
    };
  }
  return { ok: true, run: only };
};

/** A run id no stored run has yet; `node-…` for a run of one node. */
export const newRunId = (store: EventStore, prefix = ""): string => {
  for (;;) {
    const id = `${prefix}${randomUUID().slice(0, 8)}`;
    if (store.lookup(id).length === 0) return id;
  }
};
