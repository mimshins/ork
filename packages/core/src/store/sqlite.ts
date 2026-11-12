/**
 * @file The event store on `node:sqlite` (ADR-024): one database for every
 *   project, `~/.ork/state.db`, in WAL mode so other `ork` processes read while
 *   a run writes. Events are stored with secrets masked, feedback records
 *   beside them, and the registered projects; the schema is versioned with
 *   `user_version`. Tab completion opens it read-only: no store created, no
 *   migration, a store at another version refused, and the database never
 *   changed (SQLite may still add the `-wal` and `-shm` files beside it).
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { maskReplacer } from "./mask.ts";
import { ownProcessStart } from "./process-age.ts";
import { storeQueries } from "./queries.ts";
import { eventOf, inTransaction, recordOf, RUN_COLUMNS, text } from "./rows.ts";
import { migrate, requireCurrent } from "./schema.ts";
import type { EventStore, StoredEvent } from "./types.ts";

type RunEvent = StoredEvent["event"];

/** `~/.ork/state.db`; `home` is `~` (tests pass a folder). */
export const storePath = (home: string = homedir()): string =>
  path.join(home, ".ork", "state.db");

/** The node an event is about, for filtering. */
export const nodeOf = (event: RunEvent): string | null => {
  if ("id" in event && typeof event.id === "string") return event.id;
  if ("node" in event && typeof event.node === "string") return event.node;
  return null;
};

/**
 * Whether an event is about `node`, or about one of its items when it has
 * `forEach` (`build` matches `build.2`; an item's id has a `.`, a declared
 * node's never does).
 */
export const isNodeEvent = (event: RunEvent, node: string): boolean => {
  const id = nodeOf(event);
  return id === node || (id !== null && id.startsWith(`${node}.`));
};

export type StoreOptions = {
  /** This process's start, recorded with a run it begins or reopens. */
  processStart?: () => string | undefined;
  /**
   * Only read: the file must exist and be at this Ork's schema version (no
   * migration), and SQLite refuses every write (tab completion).
   */
  readOnly?: boolean;
};

/** A database opened for reading only, refused unless it is current. */
const openReadOnly = (file: string): DatabaseSync => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    requireCurrent(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

/** A database opened for writing: created, in WAL mode, migrated. */
const openWritable = (file: string): DatabaseSync => {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
};

/**
 * Opens (and creates) the store at `file`; `:memory:` for tests. With
 * `readOnly`, it neither creates nor migrates, and throws when it can't read.
 */
export const openStore = (
  file: string = storePath(),
  options: StoreOptions = {},
): EventStore => {
  const ownStart = options.processStart ?? ownProcessStart;
  const db =
    options.readOnly === true ? openReadOnly(file) : openWritable(file);

  const insertRun = db.prepare(
    `INSERT INTO runs (id, workflow, file, project, status, pid, process_start, started_at, parent, depth)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
  );
  const lastSeq = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE run_id = ?",
  );
  const insertEvent = db.prepare(
    "INSERT INTO events (run_id, seq, at, type, node, data) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const finishRun = db.prepare(
    "UPDATE runs SET status = ?, finished_at = ?, cost_usd = ?, skipped = ?, failures_handled = ? WHERE id = ?",
  );
  const reopenRun = db.prepare(
    "UPDATE runs SET status = 'running', pid = ?, process_start = ?, finished_at = NULL, skipped = NULL, failures_handled = NULL WHERE id = ?",
  );
  const addCost = db.prepare(
    "UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?",
  );
  const byId = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`);
  const byPrefix = db.prepare(
    `SELECT ${RUN_COLUMNS} FROM runs WHERE substr(id, 1, ?) = ? ORDER BY started_at DESC, rowid DESC`,
  );
  const allRuns = db.prepare(
    `SELECT ${RUN_COLUMNS} FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?`,
  );
  const projectRuns = db.prepare(
    `SELECT ${RUN_COLUMNS} FROM runs WHERE project = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
  );
  const eventsAfter = db.prepare(
    "SELECT seq, at, data FROM events WHERE run_id = ? AND seq > ? ORDER BY seq",
  );
  const controlEvents = db.prepare(
    "SELECT seq, at, data FROM events WHERE run_id = ? AND type IN ('run.command', 'run.started', 'run.finished') ORDER BY seq",
  );
  const runNodes = db.prepare(
    "SELECT node FROM events WHERE run_id = ? AND node IS NOT NULL GROUP BY node ORDER BY MIN(seq)",
  );

  const {
    insertFeedback,
    recordUsage,
    recordToolCpu,
    recordPlanLimit,
    ...queries
  } = storeQueries(db);

  return {
    ...queries,
    begin: run => {
      const startedAt = new Date().toISOString();
      const depth =
        run.parent === undefined
          ? 0
          : Number(byId.get(run.parent)?.["depth"] ?? 0) + 1;
      const processStart = ownStart();
      insertRun.run(
        run.id,
        run.workflow,
        run.file,
        run.project,
        process.pid,
        processStart ?? null,
        startedAt,
        run.parent ?? null,
        depth,
      );
      return {
        ...run,
        depth,
        status: "running",
        pid: process.pid,
        ...(processStart === undefined ? {} : { processStart }),
        startedAt,
        costUsd: 0,
      };
    },
    reopen: runId => {
      // A new process: the run is its now.
      reopenRun.run(process.pid, ownStart() ?? null, runId);
    },
    // An event and what is derived from it are written together, or not at all.
    append: (runId, event) =>
      inTransaction(db, () => {
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
        if (
          event.type === "node.event" &&
          event.event.type === "session.finished"
        ) {
          recordUsage(runId);
        }
        if (
          event.type === "node.event" &&
          event.event.type === "tool.result" &&
          event.event.cpu !== undefined
        ) {
          recordToolCpu(runId);
        }
        if (event.type === "node.event" && event.event.type === "plan.limit") {
          recordPlanLimit(event.event, at);
        }
        if (event.type === "feedback.recorded") {
          insertFeedback(runId, seq, at, event.node, event.feedback);
        }
        if (event.type === "run.finished") {
          const { status, costUsd, skipped, failuresHandled } = event.result;
          finishRun.run(
            status,
            at,
            costUsd,
            skipped ?? null,
            failuresHandled ?? null,
            runId,
          );
        }
        return { runId, seq, at, event };
      }),
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
    controlEvents: runId =>
      controlEvents.all(runId).map(r => ({
        runId,
        seq: Number(r["seq"]),
        at: text(r, "at"),
        event: eventOf(text(r, "data")),
      })),
    nodes: runId => runNodes.all(runId).map(r => text(r, "node")),
    close: () => {
      db.close();
    },
  };
};
