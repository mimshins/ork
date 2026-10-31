/**
 * @file The store's registered projects (ADR-035): which repositories Ork
 *   knows, and where it keeps each one's files (in the repository, or in
 *   `~/.ork/projects/<id>/` when attached), and moving it from one to the other
 *   (`ork migrate`) with its runs' workflow files.
 */

import path from "node:path";
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
  const move = db.prepare("UPDATE projects SET mode = ?, dir = ? WHERE id = ?");
  // A run's workflow file moves with the folder it was in.
  const refile = db.prepare(
    `UPDATE runs SET file = ? || substr(file, ?)
     WHERE project = ? AND substr(file, 1, ?) = ?`,
  );
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
    moveProject: (id, place) => {
      const before = all
        .all()
        .map(r => recordOf(r))
        .find(p => p.id === id);
      if (before === undefined) return false;
      const from = `${before.dir}${path.sep}`;
      db.exec("BEGIN");
      try {
        move.run(place.mode, place.dir, id);
        refile.run(
          `${place.dir}${path.sep}`,
          from.length + 1,
          before.root,
          from.length,
          from,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return true;
    },
  };
};
