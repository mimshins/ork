/**
 * @file The store's SQLite schema, one migration per `user_version`. A
 *   migration is SQL, or a function when it has to fold what is already there.
 */

import type { DatabaseSync } from "node:sqlite";

import { inTransaction } from "./rows.ts";
import { backfillUsage } from "./usage.ts";

export const MIGRATIONS: readonly (string | ((db: DatabaseSync) => void))[] = [
  `CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     workflow TEXT NOT NULL,
     file TEXT NOT NULL,
     project TEXT NOT NULL,
     status TEXT NOT NULL,
     pid INTEGER NOT NULL,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     cost_usd REAL NOT NULL DEFAULT 0
   );
   CREATE INDEX runs_by_project ON runs (project, started_at);
   CREATE TABLE events (
     run_id TEXT NOT NULL REFERENCES runs (id),
     seq INTEGER NOT NULL,
     at TEXT NOT NULL,
     type TEXT NOT NULL,
     node TEXT,
     data TEXT NOT NULL,
     PRIMARY KEY (run_id, seq)
   ) WITHOUT ROWID;`,
  `CREATE TABLE decisions (
     id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES runs (id),
     node TEXT NOT NULL,
     kind TEXT NOT NULL,
     question TEXT NOT NULL,
     options TEXT NOT NULL,
     recommended TEXT,
     context TEXT,
     opened_at TEXT NOT NULL,
     status TEXT NOT NULL,
     answer TEXT,
     answered_by TEXT,
     answered_at TEXT
   );
   CREATE INDEX decisions_by_status ON decisions (status, run_id);
   CREATE TABLE commands (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL REFERENCES runs (id),
     kind TEXT NOT NULL,
     at TEXT NOT NULL,
     handled_at TEXT
   );`,
  // 3: `ork chat` messages are commands with a node and a body.
  `ALTER TABLE commands ADD COLUMN node TEXT;
   ALTER TABLE commands ADD COLUMN body TEXT;`,
  // 4: feedback records, grouped by fingerprint into items with a status.
  `CREATE TABLE feedback (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL REFERENCES runs (id),
     seq INTEGER NOT NULL,
     at TEXT NOT NULL,
     node TEXT,
     source TEXT NOT NULL,
     kind TEXT NOT NULL,
     target TEXT NOT NULL,
     severity TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     evidence TEXT NOT NULL,
     code TEXT,
     fingerprint TEXT NOT NULL,
     workflow TEXT,
     workflow_hash TEXT,
     node_type TEXT,
     model TEXT,
     driver TEXT,
     version TEXT,
     feedback_version INTEGER NOT NULL
   );
   CREATE INDEX feedback_by_fingerprint ON feedback (fingerprint, at);
   CREATE TABLE feedback_items (
     fingerprint TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // 5: registered projects, in-repo (`.ork/`) or attached (`~/.ork/projects`).
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     root TEXT NOT NULL UNIQUE,
     mode TEXT NOT NULL,
     dir TEXT NOT NULL,
     registered_at TEXT NOT NULL
   );`,
  // 6: links between nodes of live runs, and who a relayed message is from.
  `CREATE TABLE links (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     a_run TEXT NOT NULL REFERENCES runs (id),
     a_node TEXT NOT NULL,
     b_run TEXT NOT NULL REFERENCES runs (id),
     b_node TEXT NOT NULL,
     max_messages INTEGER NOT NULL,
     messages INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     ended_at TEXT
   );
   CREATE INDEX links_by_a ON links (a_run);
   CREATE INDEX links_by_b ON links (b_run);
   ALTER TABLE commands ADD COLUMN sender TEXT;`,
  // 7: a run called by another: who called it, and how deep calls go.
  `ALTER TABLE runs ADD COLUMN parent TEXT;
   ALTER TABLE runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;`,
  // 8: the usage ledger (ADR-046), filled from the runs so far. Feedback loses
  // its reference to `runs`, so its records outlive a pruned run.
  db => {
    db.exec(`CREATE TABLE usage (
       run_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       at TEXT NOT NULL,
       project TEXT NOT NULL,
       workflow TEXT NOT NULL,
       node TEXT NOT NULL,
       template TEXT,
       model TEXT,
       driver TEXT,
       kind TEXT NOT NULL,
       round INTEGER NOT NULL,
       failed INTEGER NOT NULL,
       cost_usd REAL NOT NULL,
       input_tokens INTEGER NOT NULL,
       output_tokens INTEGER NOT NULL,
       cache_read_tokens INTEGER NOT NULL,
       cache_write_tokens INTEGER NOT NULL,
       turns INTEGER NOT NULL,
       duration_ms INTEGER NOT NULL,
       PRIMARY KEY (run_id, seq)
     ) WITHOUT ROWID;
     CREATE INDEX usage_by_time ON usage (at);
     CREATE INDEX usage_by_project ON usage (project, at);
     ALTER TABLE feedback RENAME TO feedback_old;
     DROP INDEX feedback_by_fingerprint;
     CREATE TABLE feedback (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       run_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       at TEXT NOT NULL,
       node TEXT,
       source TEXT NOT NULL,
       kind TEXT NOT NULL,
       target TEXT NOT NULL,
       severity TEXT NOT NULL,
       title TEXT NOT NULL,
       body TEXT NOT NULL,
       evidence TEXT NOT NULL,
       code TEXT,
       fingerprint TEXT NOT NULL,
       workflow TEXT,
       workflow_hash TEXT,
       node_type TEXT,
       model TEXT,
       driver TEXT,
       version TEXT,
       feedback_version INTEGER NOT NULL
     );
     INSERT INTO feedback SELECT * FROM feedback_old;
     DROP TABLE feedback_old;
     CREATE INDEX feedback_by_fingerprint ON feedback (fingerprint, at);`);
    backfillUsage(db);
  },
  // 9: what Claude Code last said of each of a plan's limits (RFC-007).
  `CREATE TABLE plan_limits (
     name TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     resets_at TEXT,
     at TEXT NOT NULL
   );`,
  // 10: what the workflow builder hasn't saved yet (RFC-008).
  `CREATE TABLE workflow_drafts (
     project TEXT NOT NULL,
     workflow TEXT NOT NULL,
     text TEXT NOT NULL,
     base_hash TEXT,
     at TEXT NOT NULL,
     PRIMARY KEY (project, workflow)
   );`,
  // 11: what `ork watch` keeps of each trigger (RFC-011).
  `CREATE TABLE triggers (
     project TEXT NOT NULL,
     trigger TEXT NOT NULL,
     accepted_hash TEXT,
     baselined INTEGER NOT NULL DEFAULT 0,
     looked_at TEXT,
     error TEXT,
     held TEXT,
     PRIMARY KEY (project, trigger)
   ) WITHOUT ROWID;
   CREATE TABLE trigger_seen (
     project TEXT NOT NULL,
     trigger TEXT NOT NULL,
     key TEXT NOT NULL,
     run_id TEXT,
     at TEXT NOT NULL,
     PRIMARY KEY (project, trigger, key)
   ) WITHOUT ROWID;`,
  // 12: the one `ork watch` on this machine (RFC-011).
  `CREATE TABLE watch_lock (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     pid INTEGER NOT NULL,
     at TEXT NOT NULL
   );`,
  // 13: items triage merged into another (ADR-059).
  `ALTER TABLE feedback_items ADD COLUMN merged_into TEXT;
   CREATE INDEX feedback_items_merged ON feedback_items (merged_into);`,
  // 14: when a run's process started, to tell it from a later one with its id.
  `ALTER TABLE runs ADD COLUMN process_start TEXT;`,
  // 15: what a finished run skipped and which failures it handled (G8).
  `ALTER TABLE runs ADD COLUMN skipped INTEGER;
   ALTER TABLE runs ADD COLUMN failures_handled INTEGER;`,
  // 16: what a person said with their answer to a decision (G19).
  `ALTER TABLE decisions ADD COLUMN note TEXT;`,
  // 17: the leader that took a child's question first (ADR-063).
  `ALTER TABLE decisions ADD COLUMN owner TEXT;`,
];

const versionOf = (db: DatabaseSync): number =>
  Number(db.prepare("PRAGMA user_version").get()?.["user_version"] ?? 0);

/**
 * Refuses a database that is not at this Ork's schema version, newer or older,
 * for a reader that may not migrate it (a read-only open).
 */
export const requireCurrent = (
  db: DatabaseSync,
  migrations: typeof MIGRATIONS = MIGRATIONS,
): void => {
  const version = versionOf(db);
  if (version !== migrations.length) {
    throw new Error(
      `The store is at schema version ${String(version)}; this Ork reads ${String(migrations.length)}.`,
    );
  }
};

/** Applies the migrations the database has not had yet. */
export const migrate = (
  db: DatabaseSync,
  migrations: typeof MIGRATIONS = MIGRATIONS,
): void => {
  for (const [index, step] of migrations.entries()) {
    if (index < versionOf(db)) continue;
    inTransaction(db, () => {
      // Another process may have done it while this one waited for the lock.
      if (index < versionOf(db)) return;
      if (typeof step === "string") db.exec(step);
      else step(db);
      db.exec(`PRAGMA user_version = ${String(index + 1)}`);
    });
  }
};
