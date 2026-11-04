/**
 * @file The `triggers` and `trigger_seen` tables (RFC-011): what a person
 *   accepted on this machine, when each trigger last looked, and which keys it
 *   has seen. None of it is in the repository.
 */

import type { DatabaseSync } from "node:sqlite";

import { inTransaction, text } from "./rows.ts";
import type {
  TriggerRecord,
  TriggerStore,
  WatchHolder,
} from "./trigger-types.ts";

const recordOf = (row: Record<string, unknown>): TriggerRecord => {
  const acceptedHash = text(row, "accepted_hash");
  const lookedAt = text(row, "looked_at");
  const error = text(row, "error");
  const held = text(row, "held");
  return {
    project: text(row, "project"),
    trigger: text(row, "trigger"),
    baselined: Number(row["baselined"]) === 1,
    ...(acceptedHash === "" ? {} : { acceptedHash }),
    ...(lookedAt === "" ? {} : { lookedAt }),
    ...(error === "" ? {} : { error }),
    ...(held === "" ? {} : { held }),
  };
};

const holderOf = (
  row: Record<string, unknown> | undefined,
): WatchHolder | undefined =>
  row === undefined
    ? undefined
    : { pid: Number(row["pid"]), at: text(row, "at") };

export const triggerQueries = (db: DatabaseSync): TriggerStore => {
  const all = db.prepare("SELECT * FROM triggers ORDER BY project, trigger");
  const ofProject = db.prepare(
    "SELECT * FROM triggers WHERE project = ? ORDER BY trigger",
  );
  const accept = db.prepare(
    `INSERT INTO triggers (project, trigger, accepted_hash, baselined)
     VALUES (?, ?, ?, 0)
     ON CONFLICT (project, trigger) DO UPDATE SET
       accepted_hash = excluded.accepted_hash, baselined = 0,
       error = NULL, held = NULL`,
  );
  const look = db.prepare(
    `UPDATE triggers SET looked_at = ?, error = ?, held = ?
     WHERE project = ? AND trigger = ?`,
  );
  const setBaselined = db.prepare(
    "UPDATE triggers SET baselined = 1 WHERE project = ? AND trigger = ?",
  );
  const putSeen = db.prepare(
    `INSERT OR IGNORE INTO trigger_seen (project, trigger, key, run_id, at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const isSeen = db.prepare(
    "SELECT 1 FROM trigger_seen WHERE project = ? AND trigger = ? AND key = ?",
  );
  const dropSeen = db.prepare(
    "DELETE FROM trigger_seen WHERE project = ? AND trigger = ? AND key = ?",
  );
  const runsSince = db.prepare(
    `SELECT run_id FROM trigger_seen
     WHERE project = ? AND trigger = ? AND run_id IS NOT NULL AND at >= ?
     ORDER BY at`,
  );
  const holder = db.prepare("SELECT pid, at FROM watch_lock");
  const hold = db.prepare(
    `INSERT INTO watch_lock (id, pid, at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET pid = excluded.pid, at = excluded.at`,
  );
  const letGo = db.prepare("DELETE FROM watch_lock WHERE pid = ?");
  return {
    triggerRecords: project =>
      (project === undefined ? all.all() : ofProject.all(project)).map(row =>
        recordOf(row),
      ),
    acceptTrigger: (project, trigger, hash) => {
      accept.run(project, trigger, hash);
    },
    recordLook: (project, trigger, { at, error, held }) => {
      look.run(at, error ?? null, held ?? null, project, trigger);
    },
    baselineTrigger: (project, trigger, keys, at) => {
      for (const key of keys) putSeen.run(project, trigger, key, null, at);
      setBaselined.run(project, trigger);
    },
    seenKeys: (project, trigger, keys) =>
      new Set(
        keys.filter(key => isSeen.get(project, trigger, key) !== undefined),
      ),
    markStarted: (project, trigger, key, runId, at) =>
      Number(putSeen.run(project, trigger, key, runId, at).changes) > 0,
    giveUpOn: (project, trigger, key, at) => {
      putSeen.run(project, trigger, key, null, at);
    },
    unmarkStarted: (project, trigger, key) => {
      dropSeen.run(project, trigger, key);
    },
    triggerRuns: (project, trigger, since) =>
      runsSince.all(project, trigger, since).map(row => text(row, "run_id")),
    watchHolder: () => holderOf(holder.get()),
    takeWatchHolder: (me, holds) =>
      inTransaction(db, () => {
        const current = holderOf(holder.get());
        if (current !== undefined && holds(current)) return current;
        hold.run(me.pid, me.at);
        return null;
      }),
    releaseWatchHolder: pid => {
      letGo.run(pid);
    },
  };
};
