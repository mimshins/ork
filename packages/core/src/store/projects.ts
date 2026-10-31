/**
 * @file The store's registered projects (ADR-035): which repositories Ork
 *   knows, and where it keeps each one's files (in the repository, or in
 *   `~/.ork/projects/<id>/` when attached).
 */

import type { DatabaseSync } from "node:sqlite";

import { type ProjectRecord, PROJECT_MODES } from "../project/place.ts";
import { type Row, text } from "./schema.ts";
import type { ProjectStore } from "./types.ts";

const recordOf = (row: Row): ProjectRecord => ({
  id: text(row, "id"),
  root: text(row, "root"),
  mode: PROJECT_MODES.find(m => m === text(row, "mode")) ?? "in-repo",
  dir: text(row, "dir"),
  registeredAt: text(row, "registered_at"),
});

export const projectQueries = (db: DatabaseSync): ProjectStore => {
  const all = db.prepare("SELECT * FROM projects ORDER BY id");
  const insert = db.prepare(
    `INSERT INTO projects (id, root, mode, dir, registered_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare("DELETE FROM projects WHERE id = ?");
  return {
    projects: () => all.all().map(r => recordOf(r)),
    addProject: project => {
      const record = { ...project, registeredAt: new Date().toISOString() };
      insert.run(
        record.id,
        record.root,
        record.mode,
        record.dir,
        record.registeredAt,
      );
      return record;
    },
    forgetProject: id => Number(remove.run(id).changes) > 0,
  };
};
