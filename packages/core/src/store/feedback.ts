/**
 * @file The store's feedback (specs/feedback.md): each `feedback.recorded`
 *   event written as a record, with secrets masked, and records grouped by
 *   fingerprint into items that carry a status (`ork feedback`). An item triage
 *   merged into another lists under it, with its later records too (ADR-059).
 */

import type { DatabaseSync } from "node:sqlite";

import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TARGETS,
  FEEDBACK_VERSION,
  type FeedbackOrigin,
  type FeedbackReport,
  type FeedbackSource,
} from "../feedback/types.ts";
import type {
  FeedbackItem,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackStore,
} from "./feedback-types.ts";
import { maskSecrets } from "./mask.ts";
import { inTransaction, type Row, text } from "./rows.ts";

const STATUSES: readonly FeedbackStatus[] = [
  "new",
  "triaged",
  "accepted",
  "dismissed",
  "published",
  "resolved",
];
const SOURCES: readonly FeedbackSource[] = ["system", "agent", "human"];

/** `value` if it is one of `values`, else `fallback`. */
const oneOf = <T extends string>(
  values: readonly T[],
  value: string,
  fallback: T,
): T => values.find(v => v === value) ?? fallback;

/** A JSON array column of strings, without nulls. */
const strings = (row: Row, key: string): string[] => {
  const parsed: unknown = JSON.parse(text(row, key) || "[]");
  return Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
};

const ORIGIN_COLUMNS: readonly [keyof FeedbackOrigin, string][] = [
  ["workflow", "workflow"],
  ["workflowHash", "workflow_hash"],
  ["nodeType", "node_type"],
  ["model", "model"],
  ["driver", "driver"],
  ["version", "version"],
];

const recordOf = (row: Row): FeedbackRecord => {
  const origin: FeedbackOrigin = {};
  for (const [key, column] of ORIGIN_COLUMNS) {
    const value = text(row, column);
    if (value !== "") origin[key] = value;
  }
  const feedback: FeedbackReport = {
    source: oneOf(SOURCES, text(row, "source"), "system"),
    kind: oneOf(FEEDBACK_KINDS, text(row, "kind"), "idea"),
    target: oneOf(FEEDBACK_TARGETS, text(row, "target"), "workflow"),
    severity: oneOf(FEEDBACK_SEVERITIES, text(row, "severity"), "medium"),
    title: text(row, "title"),
    body: text(row, "body"),
    evidence: strings(row, "evidence"),
    fingerprint: text(row, "fingerprint"),
    origin,
  };
  const code = text(row, "code");
  if (code !== "") feedback.code = code;
  const record: FeedbackRecord = {
    id: Number(row?.["id"]),
    runId: text(row, "run_id"),
    seq: Number(row?.["seq"]),
    at: text(row, "at"),
    feedback,
  };
  const node = text(row, "node");
  if (node !== "") record.node = node;
  return record;
};

const itemOf = (row: Row): FeedbackItem => {
  const severities = strings(row, "severities");
  const id = text(row, "fingerprint");
  return {
    id,
    merged: strings(row, "fingerprints").filter(f => f !== id),
    status: oneOf(STATUSES, text(row, "status"), "new"),
    title: text(row, "title"),
    target: oneOf(FEEDBACK_TARGETS, text(row, "target"), "workflow"),
    kind: oneOf(FEEDBACK_KINDS, text(row, "kind"), "idea"),
    severity:
      FEEDBACK_SEVERITIES.toReversed().find(s => severities.includes(s)) ??
      "medium",
    sources: strings(row, "sources").flatMap(s =>
      SOURCES.filter(known => known === s),
    ),
    count: Number(row?.["count"]),
    firstSeen: text(row, "first_seen"),
    lastSeen: text(row, "last_seen"),
    runs: strings(row, "runs"),
    workflows: strings(row, "workflows"),
    models: strings(row, "models"),
  };
};

/** Each record with the item it lists under: its own, or the one it merged into. */
const ITEMS = `SELECT r.fingerprint, r.status,
     (SELECT title FROM feedback WHERE fingerprint = r.fingerprint ORDER BY id LIMIT 1) AS title,
     MIN(f.target) AS target, MIN(f.kind) AS kind,
     json_group_array(DISTINCT f.severity) AS severities,
     json_group_array(DISTINCT f.source) AS sources,
     COUNT(*) AS count, MIN(f.at) AS first_seen, MAX(f.at) AS last_seen,
     json_group_array(DISTINCT f.run_id) AS runs,
     json_group_array(DISTINCT f.workflow) AS workflows,
     json_group_array(DISTINCT f.model) AS models,
     json_group_array(DISTINCT f.fingerprint) AS fingerprints
   FROM feedback f
   JOIN feedback_items i ON i.fingerprint = f.fingerprint
   JOIN feedback_items r ON r.fingerprint = COALESCE(i.merged_into, i.fingerprint)`;

export const feedbackQueries = (
  db: DatabaseSync,
): FeedbackStore & {
  /** Writes a `feedback.recorded` event's record. */
  insertFeedback: (
    runId: string,
    seq: number,
    at: string,
    node: string | undefined,
    feedback: FeedbackReport,
  ) => void;
} => {
  const insert = db.prepare(
    `INSERT INTO feedback (run_id, seq, at, node, source, kind, target, severity,
       title, body, evidence, code, fingerprint, workflow, workflow_hash,
       node_type, model, driver, version, feedback_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO feedback_items (fingerprint, status, updated_at)
     VALUES (?, 'new', ?) ON CONFLICT (fingerprint) DO NOTHING`,
  );
  const shown = db.prepare(
    `${ITEMS} WHERE r.status != 'dismissed' GROUP BY r.fingerprint ORDER BY last_seen DESC`,
  );
  const every = db.prepare(
    `${ITEMS} GROUP BY r.fingerprint ORDER BY last_seen DESC`,
  );
  const byPrefix = db.prepare(
    `${ITEMS} WHERE r.fingerprint IN (
       SELECT COALESCE(merged_into, fingerprint) FROM feedback_items
       WHERE substr(fingerprint, 1, ?) = ?
     ) GROUP BY r.fingerprint ORDER BY last_seen DESC`,
  );
  const records = db.prepare(
    `SELECT * FROM feedback
     WHERE fingerprint = ? OR fingerprint IN (
       SELECT fingerprint FROM feedback_items WHERE merged_into = ?
     ) ORDER BY id`,
  );
  const rootOf = db.prepare(
    "SELECT COALESCE(merged_into, fingerprint) AS root FROM feedback_items WHERE fingerprint = ?",
  );
  const mergeInto = db.prepare(
    `UPDATE feedback_items SET merged_into = ?, updated_at = ?
     WHERE (fingerprint = ? OR merged_into = ?) AND fingerprint != ?`,
  );
  const exported = db.prepare(
    `SELECT f.* FROM feedback f
     LEFT JOIN feedback_items i ON i.fingerprint = f.fingerprint
     LEFT JOIN feedback_items r ON r.fingerprint = COALESCE(i.merged_into, f.fingerprint)
     WHERE ? = 1 OR COALESCE(r.status, 'new') != 'dismissed' ORDER BY f.id`,
  );
  const known = db.prepare(
    "SELECT 1 FROM feedback WHERE run_id = ? AND seq = ?",
  );
  const split = db.prepare(
    "UPDATE feedback_items SET merged_into = NULL, updated_at = ? WHERE merged_into = ?",
  );
  const setStatus = db.prepare(
    "UPDATE feedback_items SET status = ?, updated_at = ? WHERE fingerprint = ?",
  );

  /** Writes a record, its secrets masked, and its item when it's new. */
  const insertRecord = (
    runId: string,
    seq: number,
    at: string,
    node: string | undefined,
    feedback: FeedbackReport,
  ): void => {
    const { origin } = feedback;
    insert.run(
      runId,
      seq,
      at,
      node ?? null,
      feedback.source,
      feedback.kind,
      feedback.target,
      feedback.severity,
      maskSecrets(feedback.title),
      maskSecrets(feedback.body),
      JSON.stringify(feedback.evidence.map(e => maskSecrets(e))),
      feedback.code ?? null,
      feedback.fingerprint,
      origin.workflow ?? null,
      origin.workflowHash ?? null,
      origin.nodeType ?? null,
      origin.model ?? null,
      origin.driver ?? null,
      origin.version ?? null,
      FEEDBACK_VERSION,
    );
    insertItem.run(feedback.fingerprint, at);
  };

  return {
    insertFeedback: insertRecord,
    feedbackItems: (filter = {}) =>
      (filter.all === true ? every : shown).all().map(r => itemOf(r)),
    findFeedback: prefix =>
      byPrefix.all(prefix.length, prefix).map(r => itemOf(r)),
    feedbackRecords: fingerprint =>
      records.all(fingerprint, fingerprint).map(r => recordOf(r)),
    setFeedbackStatus: (fingerprint, status) =>
      Number(
        setStatus.run(status, new Date().toISOString(), fingerprint).changes,
      ) > 0,
    mergeFeedback: (into, from) => {
      const root = text(rootOf.get(into), "root");
      if (root === "") return 0;
      const at = new Date().toISOString();
      return inTransaction(db, () =>
        from
          .filter(fingerprint => fingerprint !== root)
          .reduce(
            (moved, fingerprint) =>
              moved +
              Number(
                mergeInto.run(root, at, fingerprint, fingerprint, root).changes,
              ),
            0,
          ),
      );
    },
    splitFeedback: fingerprint =>
      Number(split.run(new Date().toISOString(), fingerprint).changes),
    exportFeedback: (filter = {}) =>
      exported.all(filter.all === true ? 1 : 0).map(r => recordOf(r)),
    importFeedback: record => {
      if (known.get(record.runId, record.seq) !== undefined) return false;
      insertRecord(
        record.runId,
        record.seq,
        record.at,
        record.node,
        record.feedback,
      );
      return true;
    },
  };
};
