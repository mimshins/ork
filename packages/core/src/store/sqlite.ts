/**
 * @file The event store on `node:sqlite` (ADR-024): one database for every
 *   project, `~/.ork/state.db`, in WAL mode so other `ork` processes read while
 *   a run writes. Events are stored with secrets masked; the schema is
 *   versioned with `user_version`.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "../run/types.ts";
import { decisionQueries } from "./decisions.ts";
import { maskReplacer } from "./mask.ts";
import { migrate, type Row, text } from "./schema.ts";
import type { EventStore, RunRecord, StoredRunStatus } from "./types.ts";

/** `~/.ork/state.db`; `home` is `~` (tests pass a folder). */
export const storePath = (home: string = homedir()): string =>
  path.join(home, ".ork", "state.db");

const STATUSES: readonly StoredRunStatus[] = [
  "running",
  "succeeded",
  "failed",
  "budget_exhausted",
  "interrupted",
];

const statusOf = (value: string): StoredRunStatus =>
  STATUSES.find(s => s === value) ?? "failed";

const recordOf = (row: Row): RunRecord => {
  const record: RunRecord = {
    id: text(row, "id"),
    workflow: text(row, "workflow"),
    file: text(row, "file"),
    project: text(row, "project"),
    status: statusOf(text(row, "status")),
    pid: Number(row?.["pid"]),
    startedAt: text(row, "started_at"),
    costUsd: Number(row?.["cost_usd"]),
  };
  const finished = text(row, "finished_at");
  if (finished !== "") record.finishedAt = finished;
  return record;
};

/** An event as the store wrote it. */
const eventOf = (data: string): RunEvent =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only append() writes this column, from a RunEvent
  JSON.parse(data) as RunEvent;

/** The node an event is about, for filtering. */
export const nodeOf = (event: RunEvent): string | null => {
  if ("id" in event && typeof event.id === "string") return event.id;
  if ("node" in event && typeof event.node === "string") return event.node;
  return null;
};

/** Opens (and creates) the store at `file`; `:memory:` for tests. */
export const openStore = (file: string = storePath()): EventStore => {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  const insertRun = db.prepare(
    `INSERT INTO runs (id, workflow, file, project, status, pid, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  );
  const lastSeq = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE run_id = ?",
  );
  const insertEvent = db.prepare(
    "INSERT INTO events (run_id, seq, at, type, node, data) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const finishRun = db.prepare(
    "UPDATE runs SET status = ?, finished_at = ?, cost_usd = ? WHERE id = ?",
  );
  const reopenRun = db.prepare(
    "UPDATE runs SET status = 'running', pid = ?, finished_at = NULL WHERE id = ?",
  );
  const addCost = db.prepare(
    "UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?",
  );
  const byId = db.prepare("SELECT * FROM runs WHERE id = ?");
  const byPrefix = db.prepare(
    "SELECT * FROM runs WHERE substr(id, 1, ?) = ? ORDER BY started_at DESC, rowid DESC",
  );
  const allRuns = db.prepare(
    "SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?",
  );
  const projectRuns = db.prepare(
    "SELECT * FROM runs WHERE project = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
  );
  const eventsAfter = db.prepare(
    "SELECT seq, at, data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq",
  );

  return {
    ...decisionQueries(db),
    begin: run => {
      const startedAt = new Date().toISOString();
      insertRun.run(
        run.id,
        run.workflow,
        run.file,
        run.project,
        process.pid,
        startedAt,
      );
      return {
        ...run,
        status: "running",
        pid: process.pid,
        startedAt,
        costUsd: 0,
      };
    },
    reopen: runId => {
      reopenRun.run(process.pid, runId);
    },
    append: (runId, event) => {
      const at = new Date().toISOString();
      const seq = Number(lastSeq.get(runId)?.["seq"] ?? 0) + 1;
      insertEvent.run(
        runId,
        seq,
        at,
        event.type,
        nodeOf(event),
        JSON.stringify(event, maskReplacer),
      );
      if (event.type === "node.finished" && event.usage !== undefined) {
        addCost.run(event.usage.costUsd, runId);
      }
      if (event.type === "run.finished") {
        finishRun.run(event.result.status, at, event.result.costUsd, runId);
      }
      return { runId, seq, at, event };
    },
    runs: (filter = {}) => {
      const limit = filter.limit ?? -1;
      const found =
        filter.project === undefined
          ? allRuns.all(limit)
          : projectRuns.all(filter.project, limit);
      return found.map(r => recordOf(r));
    },
    lookup: prefix => {
      const exact = byId.get(prefix);
      if (exact !== undefined) return [recordOf(exact)];
      return byPrefix.all(prefix.length, prefix).map(r => recordOf(r));
    },
    events: (runId, after = 0) =>
      eventsAfter.all(runId, after).map(r => ({
        runId,
        seq: Number(r["seq"]),
        at: text(r, "at"),
        event: eventOf(text(r, "data")),
      })),
    close: () => {
      db.close();
    },
  };
};
