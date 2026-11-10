/**
 * @file Reads one run and every run it called, at any depth, from a copy of
 *   Ork's store: the runs, their events, decisions and per-session usage.
 */

import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { type Json, parse, rec, text } from "./json.ts";

type Row = Record<string, SQLOutputValue>;

export type Run = {
  id: string;
  workflow: string;
  file: string;
  parent: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
};

export type StoredEvent = {
  run: string;
  at: number;
  type: string;
  node: string | null;
  data: Json;
};

export type Decision = {
  id: string;
  run: string;
  node: string;
  kind: string;
  openedAt: number;
  closedAt: number | null;
};

export type Usage = {
  run: string;
  workflow: string;
  node: string;
  model: string;
  driver: string;
  kind: string;
  round: number;
  failed: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  durationMs: number;
  at: string;
};

export type Tree = {
  runs: Run[];
  events: StoredEvent[];
  decisions: Decision[];
  usage: Usage[];
};

const str = (v: SQLOutputValue | undefined): string =>
  v === null || v === undefined ? "" : String(v);
const orNull = (v: SQLOutputValue | undefined): string | null =>
  v === null || v === undefined ? null : String(v);
const num = (v: SQLOutputValue | undefined): number => Number(v ?? 0);
const time = (v: SQLOutputValue | undefined): number => Date.parse(str(v));

const toRun = (row: Row): Run => ({
  id: str(row["id"]),
  workflow: str(row["workflow"]),
  file: str(row["file"]),
  parent: orNull(row["parent"]),
  status: str(row["status"]),
  startedAt: str(row["started_at"]),
  finishedAt: orNull(row["finished_at"]),
  costUsd: num(row["cost_usd"]),
});

const toEvent = (e: Row): StoredEvent => ({
  run: str(e["run_id"]),
  at: time(e["at"]),
  type: str(e["type"]),
  node: orNull(e["node"]),
  data: rec(parse(str(e["data"]))),
});

const toUsage = (u: Row): Usage => ({
  run: str(u["run_id"]),
  workflow: str(u["workflow"]),
  node: str(u["node"]),
  model: str(u["model"]),
  driver: str(u["driver"]),
  kind: str(u["kind"]),
  round: num(u["round"]),
  failed: num(u["failed"]) === 1,
  costUsd: num(u["cost_usd"]),
  inputTokens: num(u["input_tokens"]),
  outputTokens: num(u["output_tokens"]),
  cacheReadTokens: num(u["cache_read_tokens"]),
  cacheWriteTokens: num(u["cache_write_tokens"]),
  turns: num(u["turns"]),
  durationMs: num(u["duration_ms"]),
  at: str(u["at"]),
});

/** The one run an id prefix names. */
const runIdOf = (db: DatabaseSync, prefix: string): string => {
  const found = db
    .prepare("select id from runs where id like ?")
    .all(`${prefix}%`);
  const [only] = found;
  if (only === undefined) throw new Error(`No run ${prefix}.`);
  if (found.length > 1) {
    throw new Error(
      `${prefix} names ${String(found.length)} runs; give more of its id.`,
    );
  }
  return str(only["id"]);
};

/** The run a prefix names, and every run it called, at any depth. */
export const loadTree = (db: DatabaseSync, prefix: string): Tree => {
  const runs: Run[] = [];
  const queue = [runIdOf(db, prefix)];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const [row] = db.prepare("select * from runs where id = ?").all(id);
    if (row !== undefined) runs.push(toRun(row));
    const children = db
      .prepare("select id from runs where parent = ? order by started_at")
      .all(id);
    for (const child of children) queue.push(str(child["id"]));
  }
  const ids = runs.map(r => r.id);
  const marks = ids.map(() => "?").join(",");
  const events = db
    .prepare(
      `select run_id, at, type, node, data from events where run_id in (${marks}) order by at, run_id, seq`,
    )
    .all(...ids)
    .map(e => toEvent(e));
  const withdrawn = new Map(
    events
      .filter(e => e.type === "decision.withdrawn")
      .map(e => [text(e.data["decision"]) ?? "", e.at]),
  );
  const decisions = db
    .prepare(
      `select id, run_id, node, kind, opened_at, answered_at from decisions where run_id in (${marks}) order by opened_at`,
    )
    .all(...ids)
    .map((d): Decision => ({
      id: str(d["id"]),
      run: str(d["run_id"]),
      node: str(d["node"]),
      kind: str(d["kind"]),
      openedAt: time(d["opened_at"]),
      closedAt:
        d["answered_at"] === null
          ? (withdrawn.get(str(d["id"])) ?? null)
          : time(d["answered_at"]),
    }));
  const usage = db
    .prepare(
      `select * from usage where run_id in (${marks}) order by at, run_id, seq`,
    )
    .all(...ids)
    .map(u => toUsage(u));
  return { runs, events, decisions, usage };
};
