/**
 * @file The `follow_ups` table: every project's follow-ups on this machine,
 *   whatever its rule writes them out to (a file, GitHub issues), so they can
 *   be listed, come due and be closed in one place. A row is the follow-up as
 *   JSON, with its project, status and ref beside it for queries.
 */

import type { DatabaseSync } from "node:sqlite";

import type { FollowUp } from "../follow-ups/types.ts";
import { text } from "./rows.ts";

export type FollowUpRows = {
  /** Inserts it, or replaces the one with its id. */
  putFollowUp: (followUp: FollowUp) => void;
  followUp: (project: string, id: string) => FollowUp | undefined;
  /** A project's follow-ups, oldest first. */
  followUps: (project: string) => FollowUp[];
};

const parse = (row: Record<string, unknown>): FollowUp =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only putFollowUp writes this column, from a FollowUp
  JSON.parse(text(row, "data")) as FollowUp;

export const followUpQueries = (db: DatabaseSync): FollowUpRows => {
  const put = db.prepare(
    `INSERT INTO follow_ups (id, project, status, ref, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, ref = excluded.ref, data = excluded.data`,
  );
  const one = db.prepare(
    "SELECT data FROM follow_ups WHERE project = ? AND id = ?",
  );
  const all = db.prepare(
    "SELECT data FROM follow_ups WHERE project = ? ORDER BY created_at, rowid",
  );
  return {
    putFollowUp: f => {
      put.run(
        f.id,
        f.project,
        f.status,
        f.ref ?? null,
        f.createdAt,
        JSON.stringify(f),
      );
    },
    followUp: (project, id) => {
      const row = one.get(project, id);
      return row === undefined ? undefined : parse(row);
    },
    followUps: project => all.all(project).map(row => parse(row)),
  };
};
