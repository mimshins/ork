/**
 * @file The store's feedback (specs/feedback.md): each `feedback.recorded`
 *   event written as a record, with secrets masked, and records grouped by
 *   fingerprint into items that carry a status (`ork feedback`).
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
import { maskSecrets } from "./mask.ts";
import { type Row, text } from "./schema.ts";
import type {
  FeedbackItem,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackStore,
} from "./types.ts";

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
  return {
    id: text(row, "fingerprint"),
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

const ITEMS = `SELECT f.fingerprint, i.status,
     (SELECT title FROM feedback WHERE fingerprint = f.fingerprint ORDER BY id LIMIT 1) AS title,
     MIN(f.target) AS target, MIN(f.kind) AS kind,
     json_group_array(DISTINCT f.severity) AS severities,
     json_group_array(DISTINCT f.source) AS sources,
     COUNT(*) AS count, MIN(f.at) AS first_seen, MAX(f.at) AS last_seen,
     json_group_array(DISTINCT f.run_id) AS runs,
     json_group_array(DISTINCT f.workflow) AS workflows,
     json_group_array(DISTINCT f.model) AS models
   FROM feedback f JOIN feedback_items i ON i.fingerprint = f.fingerprint`;

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
    `${ITEMS} WHERE i.status != 'dismissed' GROUP BY f.fingerprint ORDER BY last_seen DESC`,
  );
  const every = db.prepare(
    `${ITEMS} GROUP BY f.fingerprint ORDER BY last_seen DESC`,
  );
  const byPrefix = db.prepare(
    `${ITEMS} WHERE substr(f.fingerprint, 1, ?) = ? GROUP BY f.fingerprint ORDER BY last_seen DESC`,
  );
  const records = db.prepare(
    "SELECT * FROM feedback WHERE fingerprint = ? ORDER BY id",
  );
  const setStatus = db.prepare(
    "UPDATE feedback_items SET status = ?, updated_at = ? WHERE fingerprint = ?",
  );

  return {
    insertFeedback: (runId, seq, at, node, feedback) => {
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
    },
    feedbackItems: (filter = {}) =>
      (filter.all === true ? every : shown).all().map(r => itemOf(r)),
    findFeedback: prefix =>
      byPrefix.all(prefix.length, prefix).map(r => itemOf(r)),
    feedbackRecords: fingerprint =>
      records.all(fingerprint).map(r => recordOf(r)),
    setFeedbackStatus: (fingerprint, status) =>
      Number(
        setStatus.run(status, new Date().toISOString(), fingerprint).changes,
      ) > 0,
  };
};
