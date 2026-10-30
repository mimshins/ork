/**
 * @file The store's SQLite schema, one migration per `user_version`, and the
 *   helpers that read its rows without type assertions.
 */

import type { DatabaseSync } from "node:sqlite";

export const MIGRATIONS = [
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
];

export type Row = Record<string, unknown> | undefined;

/** A text column, or `""` when it is null. */
export const text = (row: Row, key: string): string => {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
};

/** Applies the migrations the database has not had yet. */
export const migrate = (db: DatabaseSync): void => {
  const version = Number(
    db.prepare("PRAGMA user_version").get()?.["user_version"] ?? 0,
  );
  for (const [index, sql] of MIGRATIONS.entries()) {
    if (index < version) continue;
    db.exec("BEGIN");
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${String(index + 1)}`);
    db.exec("COMMIT");
  }
};
