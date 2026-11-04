/**
 * @file The usage ledger (ADR-046): one row per finished Claude session, folded
 *   from the run's events as they are written, so reports read one small table
 *   and pruning a run's transcript keeps what it spent. Sessions are the source
 *   because a `workflow.call` node's own usage is its called run's, which has
 *   rows of its own, and because `ork chat` spends outside any node.
 */

import type { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "../run/types.ts";
import { ownSpend } from "../usage/spend.ts";
import { eventOf, inTransaction, type Row, text } from "./rows.ts";
import type { RunRecord, UsageFilter, UsageRow, UsageStore } from "./types.ts";
import { processAlive, templateOf } from "./view.ts";

type RunOf = Pick<RunRecord, "id" | "project" | "workflow">;
type SeenEvent = { seq: number; at: string; event: RunEvent };

/** Folds a run's events into its sessions' rows, oldest first. */
export const usageRowsOf = (
  run: RunOf,
  events: Iterable<SeenEvent>,
): UsageRow[] => {
  const rows: UsageRow[] = [];
  const declared = new Set<string>();
  const rounds = new Map<string, number>();
  const open = new Set<string>();
  const sessions = new Map<string, { model: string; driver?: string }>();
  const reported = new Map<string, number>();
  for (const { seq, at, event } of events) {
    if (event.type === "run.started") {
      for (const node of event.nodes) declared.add(node.id);
    } else if (event.type === "node.started") {
      rounds.set(event.id, event.round);
      open.add(event.id);
    } else if (event.type === "node.finished") {
      open.delete(event.id);
    } else if (event.type === "node.event") {
      const inner = event.event;
      if (inner.type === "session.started") {
        sessions.set(event.id, {
          model: inner.model,
          ...(inner.driver === undefined ? {} : { driver: inner.driver }),
        });
      } else if (inner.type === "session.finished") {
        const { outcome } = inner;
        const session = sessions.get(event.id);
        const template = declared.has(event.id)
          ? undefined
          : templateOf(event.id, declared);
        rows.push({
          runId: run.id,
          seq,
          at,
          project: run.project,
          workflow: run.workflow,
          node: event.id,
          ...(template === undefined ? {} : { template }),
          ...(session === undefined ? {} : { model: session.model }),
          ...(session?.driver === undefined ? {} : { driver: session.driver }),
          kind: open.has(event.id) ? "node" : "chat",
          round: rounds.get(event.id) ?? 1,
          failed:
            outcome.subtype !== "success" || outcome.report?.status === "fail",
          ...outcome.usage,
          costUsd: ownSpend(
            reported,
            `${event.id}/${outcome.sessionId}`,
            outcome.usage.costUsd,
          ),
        });
      }
    }
  }
  return rows;
};

const SOURCE = `SELECT seq, at, data FROM events
  WHERE run_id = ? AND (
    type IN ('run.started', 'node.started', 'node.finished')
    OR (type = 'node.event'
        AND json_extract(data, '$.event.type') IN ('session.started', 'session.finished'))
  ) ORDER BY seq`;

const INSERT = `INSERT OR IGNORE INTO usage (
    run_id, seq, at, project, workflow, node, template, model, driver, kind,
    round, failed, cost_usd, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, turns, duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const rowsFromEvents = (db: DatabaseSync, run: RunOf): UsageRow[] =>
  usageRowsOf(
    run,
    db
      .prepare(SOURCE)
      .all(run.id)
      .map(r => ({
        seq: Number(r["seq"]),
        at: text(r, "at"),
        event: eventOf(text(r, "data")),
      })),
  );

const writeRow = (
  insert: ReturnType<DatabaseSync["prepare"]>,
  row: UsageRow,
): void => {
  insert.run(
    row.runId,
    row.seq,
    row.at,
    row.project,
    row.workflow,
    row.node,
    row.template ?? null,
    row.model ?? null,
    row.driver ?? null,
    row.kind,
    row.round,
    row.failed ? 1 : 0,
    row.costUsd,
    row.inputTokens,
    row.outputTokens,
    row.cacheReadTokens,
    row.cacheWriteTokens,
    row.turns,
    row.durationMs,
  );
};

/** Fills the ledger from the runs recorded before it existed. */
export const backfillUsage = (db: DatabaseSync): void => {
  const insert = db.prepare(INSERT);
  for (const run of db
    .prepare("SELECT id, project, workflow FROM runs")
    .all()) {
    const rows = rowsFromEvents(db, {
      id: text(run, "id"),
      project: text(run, "project"),
      workflow: text(run, "workflow"),
    });
    for (const row of rows) writeRow(insert, row);
  }
};

const rowOf = (r: Row): UsageRow => {
  const template = text(r, "template");
  const model = text(r, "model");
  const driver = text(r, "driver");
  return {
    runId: text(r, "run_id"),
    seq: Number(r?.["seq"]),
    at: text(r, "at"),
    project: text(r, "project"),
    workflow: text(r, "workflow"),
    node: text(r, "node"),
    ...(template === "" ? {} : { template }),
    ...(model === "" ? {} : { model }),
    ...(driver === "" ? {} : { driver }),
    kind: text(r, "kind") === "chat" ? "chat" : "node",
    round: Number(r?.["round"]),
    failed: Number(r?.["failed"]) === 1,
    costUsd: Number(r?.["cost_usd"]),
    inputTokens: Number(r?.["input_tokens"]),
    outputTokens: Number(r?.["output_tokens"]),
    cacheReadTokens: Number(r?.["cache_read_tokens"]),
    cacheWriteTokens: Number(r?.["cache_write_tokens"]),
    turns: Number(r?.["turns"]),
    durationMs: Number(r?.["duration_ms"]),
  };
};

const whereOf = (filter: UsageFilter): { sql: string; values: string[] } => {
  const clauses: string[] = [];
  const values: string[] = [];
  const add = (clause: string, value: string | undefined) => {
    if (value === undefined) return;
    clauses.push(clause);
    values.push(value);
  };
  add("project = ?", filter.project);
  add("workflow = ?", filter.workflow);
  add("at >= ?", filter.since);
  add("at < ?", filter.until);
  return {
    sql: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    values,
  };
};

const alive = (row: Row): boolean => processAlive(Number(row?.["pid"]));

/** The ledger's queries; `recordUsage` is the store's own, called on append. */
export const usageQueries = (
  db: DatabaseSync,
): Omit<UsageStore, "planLimits" | "clearPlanLimits"> & {
  recordUsage: (runId: string) => void;
} => {
  const insert = db.prepare(INSERT);
  const spentAll = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage WHERE at >= ?",
  );
  const spentHere = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage WHERE at >= ? AND project = ?",
  );
  const runById = db.prepare(
    "SELECT id, project, workflow FROM runs WHERE id = ?",
  );
  const lastEvent = db.prepare(
    "SELECT at FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
  );
  const liveOne = db.prepare(
    "SELECT pid FROM runs WHERE id = ? AND status = 'running'",
  );
  const liveAny = db.prepare("SELECT pid FROM runs WHERE status = 'running'");
  const deletes = [
    "DELETE FROM events WHERE run_id = ?",
    "DELETE FROM decisions WHERE run_id = ?",
    "DELETE FROM commands WHERE run_id = ?",
    "DELETE FROM links WHERE a_run = ?1 OR b_run = ?1",
    "DELETE FROM runs WHERE id = ?",
  ].map(sql => db.prepare(sql));
  return {
    // All of the run's rows: a process from before the ledger may have left a gap.
    recordUsage: runId => {
      const run = runById.get(runId);
      if (run === undefined) return;
      const rows = rowsFromEvents(db, {
        id: runId,
        project: text(run, "project"),
        workflow: text(run, "workflow"),
      });
      for (const row of rows) writeRow(insert, row);
    },
    spentSince: (since, project) =>
      Number(
        (project === undefined
          ? spentAll.get(since)
          : spentHere.get(since, project))?.["spent"] ?? 0,
      ),
    usage: (filter = {}) => {
      const { sql, values } = whereOf(filter);
      return db
        .prepare(`SELECT * FROM usage ${sql} ORDER BY at, run_id, seq`)
        .all(...values)
        .map(r => rowOf(r));
    },
    lastEventAt: runId => {
      const at = text(lastEvent.get(runId), "at");
      return at === "" ? undefined : at;
    },
    deleteRun: runId =>
      inTransaction(db, () => {
        const live = liveOne.get(runId);
        if (live !== undefined && alive(live)) return false;
        for (const statement of deletes) statement.run(runId);
        return true;
      }),
    compact: () => {
      // VACUUM holds the write lock throughout, which a live run cannot wait for.
      if (liveAny.all().some(row => alive(row))) return "a run is going";
      try {
        db.exec("VACUUM");
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /locked|busy/iu.test(message)
          ? "another process is using the store"
          : message;
      }
    },
  };
};
