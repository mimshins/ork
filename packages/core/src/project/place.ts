/**
 * @file Where Ork keeps a project's own files (ADR-035): `.ork/` in the
 *   repository (in-repo), or `~/.ork/projects/<id>/` for a project registered
 *   from outside it (attached), which leaves the repository untouched. Both
 *   hold the same things: `workflows/`, `project.yaml`, `runs/`, `lessons/` and
 *   `agents/`.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { inside, projectRootOf } from "../context/files.ts";

export const PROJECT_MODES = ["in-repo", "attached"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export type ProjectPlace = {
  /** The project's git root (its main clone). */
  root: string;
  mode: ProjectMode;
  /** Ork's folder for it: `<root>/.ork`, or `~/.ork/projects/<id>`. */
  dir: string;
  /** Set when the project is registered (`ork register`, `ork init`). */
  id?: string;
};

/** A registered project, as the store keeps it. */
export type ProjectRecord = ProjectPlace & { id: string; registeredAt: string };

/** The folder in-repo projects keep Ork's files in. */
export const ORK_DIR = ".ork";

/** `~/.ork/projects`, where attached projects live. */
export const projectsHome = (home: string = homedir()): string =>
  path.join(home, ORK_DIR, "projects");

/** An in-repo project: Ork's files in `<root>/.ork`. */
export const inRepoPlace = (root: string): ProjectPlace => ({
  root,
  mode: "in-repo",
  dir: path.join(root, ORK_DIR),
});

/** The files and folders of a project's place. */
export const placeFiles = (place: ProjectPlace) => ({
  workflows: path.join(place.dir, "workflows"),
  rules: path.join(place.dir, "project.yaml"),
  runs: path.join(place.dir, "runs"),
  lessons: path.join(place.dir, "lessons"),
  agents: path.join(place.dir, "agents"),
});

/** A run's own folder: logs, plugins, long tool output. */
export const runDirOf = (place: ProjectPlace, runId: string): string =>
  path.join(placeFiles(place).runs, runId);

const real = (target: string): string => {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
};

/**
 * The project a folder belongs to: the attached project whose folder holds it,
 * else the project at its git root, registered or not (an unregistered one is
 * in-repo).
 */
export const placeFor = (
  dir: string,
  registered: readonly ProjectPlace[],
): ProjectPlace => {
  const target = real(dir);
  const home = registered.find(
    p => p.mode === "attached" && inside(real(p.dir), target),
  );
  if (home !== undefined) return home;
  const root = projectRootOf(target);
  return registered.find(p => real(p.root) === root) ?? inRepoPlace(root);
};

/**
 * The folder a workflow's relative paths resolve from. An attached project's
 * workflow reads the repository as if it were in `<root>/.ork/workflows/`, so
 * `ork migrate` can move it there without changing a path.
 */
export const workflowDirOf = (place: ProjectPlace, file: string): string => {
  const folder = path.dirname(path.resolve(file));
  if (place.mode !== "attached" || !inside(real(place.dir), real(folder))) {
    return folder;
  }
  return path.join(
    place.root,
    ORK_DIR,
    path.relative(real(place.dir), real(folder)),
  );
};

/** A path for messages: project-relative, `~/…`, or absolute. */
export const shownPath = (
  file: string,
  root: string,
  home: string = homedir(),
): string => {
  if (inside(root, file)) return path.relative(root, file);
  if (inside(home, file)) return path.join("~", path.relative(home, file));
  return file;
};

/** A new attached project's id: its folder's name, made unique. */
export const newProjectId = (
  root: string,
  taken: readonly string[],
): string => {
  const base =
    path
      .basename(root)
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/gu, "-")
      .replaceAll(/^[-.]+|-+$/gu, "") || "project";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${String(n)}`;
  return id;
};

/** Whether `root` already keeps Ork's files in the repository. */
export const hasInRepoFiles = (root: string): boolean => {
  const files = placeFiles(inRepoPlace(root));
  return existsSync(files.workflows) || existsSync(files.rules);
};
