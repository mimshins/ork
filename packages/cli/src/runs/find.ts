/**
 * @file Finding a stored run from a command's argument: a run id or a unique
 *   prefix of one, or, with none, the newest run of this project.
 */

import { type EventStore, placeFor, type RunRecord } from "@krapht/ork-core";

export type FoundRun =
  | { ok: true; run: RunRecord }
  | { ok: false; error: string };

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
