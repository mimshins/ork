/**
 * @file Unfinished workflows (RFC-008): the workflow builder keeps what it's
 *   editing here, not in the workflows folder, as a draft passes through states
 *   a running workflow's call must never read. It survives a closed tab and a
 *   new port, and goes when it's saved or discarded; `ork prune` leaves it.
 */

import type { DatabaseSync } from "node:sqlite";

import { text } from "./rows.ts";

/** A workflow the builder is editing and hasn't saved (RFC-008). */
export type WorkflowDraft = {
  project: string;
  /** Its file's name in the workflows folder, without `.ork.yaml`. */
  workflow: string;
  text: string;
  /** The hash of the file this began from; `null` for a new workflow. */
  baseHash: string | null;
  at: string;
};

export type DraftStore = {
  putDraft: (draft: WorkflowDraft) => void;
  draft: (project: string, workflow: string) => WorkflowDraft | undefined;
  /** A project's drafts, by name. */
  drafts: (project: string) => WorkflowDraft[];
  dropDraft: (project: string, workflow: string) => void;
};

const rowOf = (row: Record<string, unknown>): WorkflowDraft => {
  const baseHash = text(row, "base_hash");
  return {
    project: text(row, "project"),
    workflow: text(row, "workflow"),
    text: text(row, "text"),
    baseHash: baseHash === "" ? null : baseHash,
    at: text(row, "at"),
  };
};

export const draftQueries = (db: DatabaseSync): DraftStore => {
  const put = db.prepare(
    "INSERT OR REPLACE INTO workflow_drafts (project, workflow, text, base_hash, at) VALUES (?, ?, ?, ?, ?)",
  );
  const one = db.prepare(
    "SELECT project, workflow, text, base_hash, at FROM workflow_drafts WHERE project = ? AND workflow = ?",
  );
  const all = db.prepare(
    "SELECT project, workflow, text, base_hash, at FROM workflow_drafts WHERE project = ? ORDER BY workflow",
  );
  const drop = db.prepare(
    "DELETE FROM workflow_drafts WHERE project = ? AND workflow = ?",
  );
  return {
    putDraft: draft => {
      put.run(
        draft.project,
        draft.workflow,
        draft.text,
        draft.baseHash,
        draft.at,
      );
    },
    draft: (project, workflow) => {
      const row = one.get(project, workflow);
      return row === undefined ? undefined : rowOf(row);
    },
    drafts: project => all.all(project).map(row => rowOf(row)),
    dropDraft: (project, workflow) => {
      drop.run(project, workflow);
    },
  };
};
