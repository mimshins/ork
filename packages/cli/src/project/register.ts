/**
 * @file Registering projects (ADR-035): `ork register` attaches a repository
 *   from outside it, with its workflows, rules and runs in
 *   `~/.ork/projects/<id>/` and nothing written into the repository; `ork init`
 *   records an in-repo project, whose files are its `.ork/`.
 */

import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  type EventStore,
  hasInRepoFiles,
  inRepoPlace,
  newProjectId,
  placeFiles,
  projectRootOf,
  type ProjectRecord,
  projectsHome,
  shownPath,
} from "@krapht/ork-core";

import { style } from "../output.ts";

export type Registered =
  | { ok: true; project: ProjectRecord; created: boolean }
  | { ok: false; error: string };

const ID = /^[a-z0-9][a-z0-9._-]*$/u;

/** The git root of `target`'s main clone, or why there is none. */
const cloneOf = (
  target: string,
): { ok: true; root: string } | { ok: false; error: string } => {
  if (!existsSync(target))
    return { ok: false, error: `${target} does not exist` };
  const root = projectRootOf(realpathSync(target));
  const dotGit = path.join(root, ".git");
  if (!existsSync(dotGit)) {
    return { ok: false, error: `${target} is not in a git repository` };
  }
  if (statSync(dotGit).isFile()) {
    return {
      ok: false,
      error: `${root} is a git worktree; register the main clone instead`,
    };
  }
  return { ok: true, root };
};

/**
 * Attaches the repository at `target`: creates `~/.ork/projects/<id>/workflows`
 * and records the project. Registering it again returns the same project.
 */
export const registerProject = (
  store: Pick<EventStore, "projects" | "addProject">,
  target: string,
  options: { id?: string; home?: string } = {},
): Registered => {
  const clone = cloneOf(target);
  if (!clone.ok) return clone;
  const { root } = clone;
  const projects = store.projects();
  const existing = projects.find(p => p.root === root);
  if (existing?.mode === "attached") {
    return { ok: true, project: existing, created: false };
  }
  if (existing !== undefined || hasInRepoFiles(root)) {
    return {
      ok: false,
      error: `${root} keeps Ork's files in its own .ork/ (in-repo), so it is not attached`,
    };
  }
  const taken = projects.map(p => p.id);
  if (options.id !== undefined) {
    if (!ID.test(options.id)) {
      return {
        ok: false,
        error: `--id "${options.id}" must be lowercase letters, digits, ".", "_" or "-"`,
      };
    }
    if (taken.includes(options.id)) {
      return {
        ok: false,
        error: `a project is already registered as ${options.id}`,
      };
    }
  }
  const id = options.id ?? newProjectId(root, taken);
  const dir = path.join(projectsHome(options.home), id);
  const project = { id, root, mode: "attached" as const, dir };
  mkdirSync(placeFiles(project).workflows, { recursive: true });
  return { ok: true, project: store.addProject(project), created: true };
};

/**
 * Records the in-repo project at `cwd`'s git root, if it is not registered yet;
 * an attached one stays attached (`ork init` must not take it over).
 */
export const recordInRepo = (
  store: Pick<EventStore, "projects" | "addProject">,
  cwd: string,
): Registered => {
  const root = projectRootOf(realpathSync(cwd));
  const projects = store.projects();
  const existing = projects.find(p => p.root === root);
  if (existing?.mode === "attached") {
    return {
      ok: false,
      error: `${root} is attached: its workflows are in ${shownPath(existing.dir, root)}, and Ork writes nothing into the repository`,
    };
  }
  if (existing !== undefined) {
    return { ok: true, project: existing, created: false };
  }
  const project = {
    ...inRepoPlace(root),
    id: newProjectId(
      root,
      projects.map(p => p.id),
    ),
  };
  return { ok: true, project: store.addProject(project), created: true };
};

/** One project's lines for `ork projects`. */
export const formatProject = (project: ProjectRecord): string[] => {
  const gone = existsSync(project.root) ? "" : style("yellow", " (missing)");
  return [
    `${style("bold", project.id)}  ${style("dim", project.mode)}  ${project.root}${gone}`,
    style("dim", `  files: ${shownPath(project.dir, project.root)}`),
  ];
};

/** What `ork register` prints: the project, and where its files go. */
export const formatRegistered = (
  project: ProjectRecord,
  created: boolean,
): string[] => {
  const files = placeFiles(project);
  const shown = (file: string) => shownPath(file, project.root);
  return [
    `${style("green", created ? "registered" : "already registered")} ${project.id} → ${project.root}`,
    `\nWorkflows: ${shown(files.workflows)}/ · rules: ${shown(files.rules)} · runs: ${shown(files.runs)}/`,
    `Nothing is written into ${project.root}. In it, ${style("bold", "ork run <name>")} finds the workflows above.`,
  ];
};
