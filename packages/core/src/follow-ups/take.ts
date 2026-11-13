/**
 * @file Taking `agent` follow-ups as a run's brief (`ork run --follow-ups`): an
 *   open one is marked taken by the run, except one another run still going has
 *   taken, which is refused (an explicit id) or skipped (`due`) so two runs do
 *   not do the same work.
 */

import type { FollowUpRows } from "../store/follow-ups.ts";
import type { FollowUp } from "./types.ts";

const put = (rows: FollowUpRows, f: FollowUp, run: string, at: string) => {
  const next = { ...f, takenBy: run, updatedAt: at };
  rows.putFollowUp(next);
  return next;
};

/**
 * Whether the run with this id is still going (a crashed or ended one is not);
 * `undefined` when the store has no record of it (yet).
 */
export type RunLive = (runId: string) => boolean | undefined;

/**
 * How long a mark of a run the store does not know yet still holds: a run marks
 * its follow-ups before its first record, and its preflight takes seconds.
 */
export const UNRECORDED_GRACE_MS = 2 * 60_000;

/**
 * Whether another, live run has taken `f`: it is not free to take again. A run
 * the store does not know counts as live while the mark is recent, so a run
 * that fails its preflight frees its follow-ups when the window ends.
 */
const heldByLive = (
  f: FollowUp,
  run: string,
  isLive: RunLive,
  now: number,
): boolean => {
  if (f.takenBy === undefined || f.takenBy === run) return false;
  const live = isLive(f.takenBy);
  return live ?? now - Date.parse(f.updatedAt) < UNRECORDED_GRACE_MS;
};

/**
 * The project's due `agent` follow-ups no live run has taken (`ids`), and those
 * a live run holds (`held`), so a second `--follow-ups due` doesn't take them
 * twice.
 */
export const availableDue = (
  rows: FollowUpRows,
  project: string,
  isLive: RunLive,
  run = "",
  now: () => string = () => new Date().toISOString(),
): { ids: string[]; held: FollowUp[] } => {
  const at = Date.parse(now());
  const due = rows
    .followUps(project)
    .filter(f => f.for === "agent" && f.status === "due");
  return {
    ids: due.filter(f => !heldByLive(f, run, isLive, at)).map(f => f.id),
    held: due.filter(f => heldByLive(f, run, isLive, at)),
  };
};

/**
 * `ork run start --follow-ups <ids>`: the open `agent` follow-ups among `ids`
 * become `run`'s brief; why each other id wasn't taken. One a live run took is
 * refused; one a finished, failed or crashed run took can be taken again.
 */
export const takeFollowUps = (
  rows: FollowUpRows,
  taking: {
    project: string;
    run: string;
    ids: readonly string[];
    isLive: RunLive;
  },
  now: () => string = () => new Date().toISOString(),
): { taken: FollowUp[]; refused: string[] } => {
  const taken: FollowUp[] = [];
  const refused: string[] = [];
  for (const id of taking.ids) {
    const f = rows.followUp(taking.project, id);
    if (f === undefined) refused.push(`${id}: there is no such follow-up`);
    else if (f.for !== "agent") refused.push(`${id}: it is for ${f.for}`);
    else if (f.status === "done" || f.status === "dropped") {
      refused.push(`${id}: it is ${f.status}`);
    } else if (heldByLive(f, taking.run, taking.isLive, Date.parse(now()))) {
      refused.push(`${id}: taken by run ${f.takenBy}, still running`);
    } else taken.push(put(rows, f, taking.run, now()));
  }
  return { taken, refused };
};
