/**
 * @file The CPU each of Ork's tool commands used (a tool node's, a `verify:` or
 *   `before:` step's), folded from their `tool.result` events into a small
 *   table beside the usage ledger, so `ork usage --by node` reads it and a
 *   pruned transcript keeps it.
 */

import type { DatabaseSync } from "node:sqlite";

import { eventOf, text } from "./rows.ts";
import type { ToolCpuRow, UsageFilter } from "./usage-types.ts";
import { whereOf } from "./usage.ts";
import { templateOf } from "./view.ts";

const SOURCE = `SELECT seq, at, data FROM events
  WHERE run_id = ? AND (
    type = 'run.started'
    OR (type = 'node.event' AND json_extract(data, '$.event.type') = 'tool.result'
        AND json_extract(data, '$.event.cpu') IS NOT NULL)
  ) ORDER BY seq`;

const INSERT = `INSERT OR IGNORE INTO tool_cpu (
    run_id, seq, at, project, workflow, node, template, user_ms, system_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type RunOf = { id: string; project: string; workflow: string };

/** A run's tool commands' rows, from its events. */
const rowsOf = (db: DatabaseSync, run: RunOf): ToolCpuRow[] => {
  const declared = new Set<string>();
  const rows: ToolCpuRow[] = [];
  for (const r of db.prepare(SOURCE).all(run.id)) {
    const event = eventOf(text(r, "data"));
    if (event.type === "run.started") {
      for (const node of event.nodes) declared.add(node.id);
      continue;
    }
    if (event.type !== "node.event" || event.event.type !== "tool.result") {
      continue;
    }
    const { cpu } = event.event;
    if (cpu === undefined) continue;
    const template = declared.has(event.id)
      ? undefined
      : templateOf(event.id, declared);
    rows.push({
      runId: run.id,
      seq: Number(r["seq"]),
      at: text(r, "at"),
      project: run.project,
      workflow: run.workflow,
      node: event.id,
      ...(template === undefined ? {} : { template }),
      userMs: cpu.userMs,
      systemMs: cpu.systemMs,
    });
  }
  return rows;
};

const write = (db: DatabaseSync, rows: readonly ToolCpuRow[]): void => {
  const insert = db.prepare(INSERT);
  for (const row of rows) {
    insert.run(
      row.runId,
      row.seq,
      row.at,
      row.project,
      row.workflow,
      row.node,
      row.template ?? null,
      row.userMs,
      row.systemMs,
    );
  }
};

const runsOf = (db: DatabaseSync, sql: string, ...values: string[]) =>
  db
    .prepare(sql)
    .all(...values)
    .map(run => ({
      id: text(run, "id"),
      project: text(run, "project"),
      workflow: text(run, "workflow"),
    }));

/** Fills the table from the runs recorded before it existed. */
export const backfillToolCpu = (db: DatabaseSync): void => {
  for (const run of runsOf(db, "SELECT id, project, workflow FROM runs")) {
    write(db, rowsOf(db, run));
  }
};

export const toolCpuQueries = (db: DatabaseSync) => ({
  /** Writes a run's rows; the store's own, on each timed `tool.result`. */
  recordToolCpu: (runId: string): void => {
    const [run] = runsOf(
      db,
      "SELECT id, project, workflow FROM runs WHERE id = ?",
      runId,
    );
    if (run !== undefined) write(db, rowsOf(db, run));
  },
  toolCpu: (filter: UsageFilter = {}): ToolCpuRow[] => {
    const { sql, values } = whereOf(filter);
    return db
      .prepare(`SELECT * FROM tool_cpu ${sql} ORDER BY at, run_id, seq`)
      .all(...values)
      .map(r => {
        const row: ToolCpuRow = {
          runId: text(r, "run_id"),
          seq: Number(r["seq"]),
          at: text(r, "at"),
          project: text(r, "project"),
          workflow: text(r, "workflow"),
          node: text(r, "node"),
          userMs: Number(r["user_ms"]),
          systemMs: Number(r["system_ms"]),
        };
        const template = text(r, "template");
        if (template !== "") row.template = template;
        return row;
      });
  },
});
