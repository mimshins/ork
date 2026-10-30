/**
 * @file The store's decisions and commands: what a run waits on, answered by
 *   whichever comes first (its terminal or `ork decide`), and what other
 *   processes ask a live run to do (`ork stop`).
 */

import type { DatabaseSync } from "node:sqlite";

import type { DecisionChoice } from "../runtime/types.ts";
import { maskSecrets } from "./mask.ts";
import { type Row, text } from "./schema.ts";
import type {
  AnsweredBy,
  DecisionKind,
  DecisionRecord,
  DecisionStore,
  RunCommand,
} from "./types.ts";

const choicesOf = (json: string): DecisionChoice[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown) => {
    if (item === null || typeof item !== "object" || !("id" in item)) return [];
    const { id } = item;
    if (typeof id !== "string") return [];
    const choice: DecisionChoice = { id };
    if ("label" in item && typeof item.label === "string") {
      choice.label = item.label;
    }
    if ("description" in item && typeof item.description === "string") {
      choice.description = item.description;
    }
    return [choice];
  });
};

const kindOf = (value: string): DecisionKind =>
  value === "permission" ? "permission" : "question";

const statusOf = (value: string): DecisionRecord["status"] =>
  value === "answered" || value === "withdrawn" ? value : "open";

const decisionOf = (row: Row): DecisionRecord => {
  const record: DecisionRecord = {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    node: text(row, "node"),
    kind: kindOf(text(row, "kind")),
    question: text(row, "question"),
    options: choicesOf(text(row, "options") || "[]"),
    openedAt: text(row, "opened_at"),
    status: statusOf(text(row, "status")),
  };
  const optional = {
    recommended: text(row, "recommended"),
    context: text(row, "context"),
    answer: text(row, "answer"),
    answeredAt: text(row, "answered_at"),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== "") Object.assign(record, { [key]: value });
  }
  const by = text(row, "answered_by");
  if (by === "terminal" || by === "decide") record.answeredBy = by;
  return record;
};

export const decisionQueries = (db: DatabaseSync): DecisionStore => {
  const insert = db.prepare(
    `INSERT INTO decisions (id, run_id, node, kind, question, options, recommended, context, opened_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  );
  const answer = db.prepare(
    `UPDATE decisions SET status = 'answered', answer = ?, answered_by = ?, answered_at = ?
     WHERE id = ? AND status = 'open'`,
  );
  const withdraw = db.prepare(
    "UPDATE decisions SET status = 'withdrawn', answered_at = ? WHERE id = ? AND status = 'open'",
  );
  const byId = db.prepare("SELECT * FROM decisions WHERE id = ?");
  const filtered = db.prepare(
    `SELECT d.* FROM decisions d JOIN runs r ON r.id = d.run_id
     WHERE (?1 IS NULL OR d.run_id = ?1)
       AND (?2 IS NULL OR r.project = ?2)
       AND (?3 IS NULL OR d.status = ?3)
     ORDER BY d.opened_at, d.rowid`,
  );
  const addCommand = db.prepare(
    "INSERT INTO commands (run_id, kind, at) VALUES (?, ?, ?)",
  );
  const pending = db.prepare(
    "SELECT id, kind FROM commands WHERE run_id = ? AND handled_at IS NULL ORDER BY id",
  );
  const handled = db.prepare("UPDATE commands SET handled_at = ? WHERE id = ?");

  return {
    openDecision: decision => {
      const openedAt = new Date().toISOString();
      const masked = {
        ...decision,
        question: maskSecrets(decision.question),
        ...(decision.context === undefined
          ? {}
          : { context: maskSecrets(decision.context) }),
      };
      insert.run(
        masked.id,
        masked.runId,
        masked.node,
        masked.kind,
        masked.question,
        JSON.stringify(masked.options),
        masked.recommended ?? null,
        masked.context ?? null,
        openedAt,
      );
      return { ...masked, openedAt, status: "open" };
    },
    answerDecision: (id, choice, by: AnsweredBy) =>
      Number(answer.run(choice, by, new Date().toISOString(), id).changes) ===
      1,
    withdrawDecision: id => {
      withdraw.run(new Date().toISOString(), id);
    },
    decision: id => {
      const row = byId.get(id);
      return row === undefined ? undefined : decisionOf(row);
    },
    decisions: filter =>
      filtered
        .all(
          filter.runId ?? null,
          filter.project ?? null,
          filter.status ?? null,
        )
        .map(row => decisionOf(row)),
    command: (runId, kind) => {
      addCommand.run(runId, kind, new Date().toISOString());
    },
    takeCommands: runId => {
      const at = new Date().toISOString();
      return pending.all(runId).flatMap(row => {
        handled.run(at, Number(row["id"]));
        const kind: RunCommand | undefined =
          text(row, "kind") === "stop" ? "stop" : undefined;
        return kind === undefined ? [] : [kind];
      });
    },
  };
};
