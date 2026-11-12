/**
 * @file A project's rules at compile time: reading `.ork/project.yaml`, merging
 *   it under the workflow (the workflow's `rules:`, `defaults` and context
 *   win), resolving the git rules with Ork's defaults, and checking them:
 *   placeholders, names unique per run, and a merge that fits the commit rule.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  DEFAULT_BRANCH_TEMPLATE,
  DEFAULT_WORKTREES_TEMPLATE,
  type Diagnostic,
  type DiagnosticPath,
  type ResolvedGitRules,
  isClaudeNode,
  parseProject,
  parseUserSettings,
  type Project,
  type UserSettings,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "../graph/diagnostics.ts";
import { layerPractices } from "../practices/practices.ts";
import { withoutHeavy } from "./heavy.ts";
import { shownPath } from "./place.ts";
import { placeholdersOf, templateProblems } from "./templates.ts";

/** Where an in-repo project keeps its rules. */
export const PROJECT_FILE = ".ork/project.yaml";

export type LoadedProject = {
  /** The project's rules, or `undefined` when it has no (valid) file. */
  project?: Project;
  /** Problems in the file, with `file` (and `line`, `column`) set to it. */
  diagnostics: Diagnostic[];
  /** Says where a key of a valid file is (`.ork/project.yaml:3:5`). */
  where?: (path: DiagnosticPath) => string;
  /** The same place, as a diagnostic's `file`, `line` and `column`. */
  at?: (path: DiagnosticPath) => Pick<Diagnostic, "file" | "line" | "column">;
};

/**
 * Reads `file` (by default the project's `.ork/project.yaml`; an attached
 * project's is in its own folder), if it exists.
 */
export const loadProject = (
  projectRoot: string,
  file: string = path.join(projectRoot, PROJECT_FILE),
): LoadedProject => {
  if (!existsSync(file)) return { diagnostics: [] };
  const parsed = parseProject(readFileSync(file, "utf8"));
  const label = shownPath(file, projectRoot);
  if (parsed.ok) {
    const at = (key: DiagnosticPath) => ({
      file: label,
      ...parsed.locate(key),
    });
    return {
      project: parsed.project,
      diagnostics: [],
      where: key => {
        const position = parsed.locate(key);
        return position === null
          ? label
          : `${label}:${position.line}:${position.column}`;
      },
      at,
    };
  }
  return {
    // The path stays empty: it is the project file's, not the workflow's.
    diagnostics: parsed.diagnostics.map(d =>
      Object.assign(
        error(d.code, d.message, []),
        { file: label },
        d.line === undefined ? {} : { line: d.line, column: d.column ?? 1 },
      ),
    ),
  };
};

/** Where the user's own settings live. */
export const USER_SETTINGS_FILE = path.join(".ork", "settings.yaml");

export type LoadedUserSettings = {
  settings?: UserSettings;
  diagnostics: Diagnostic[];
};

/**
 * Reads `~/.ork/settings.yaml`, if it exists. One that can't be read is
 * reported rather than ignored: it may hold a cap the user is relying on.
 */
export const loadUserSettings = (
  home: string = homedir(),
): LoadedUserSettings => {
  const file = path.join(home, USER_SETTINGS_FILE);
  if (!existsSync(file)) return { diagnostics: [] };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (failed) {
    const reason = failed instanceof Error ? failed.message : String(failed);
    return {
      diagnostics: [
        error("settings.read", `~/${USER_SETTINGS_FILE}: ${reason}`, []),
      ],
    };
  }
  // A file of only comments says nothing, as no file does.
  if (text.split("\n").every(line => /^\s*(?:#.*)?$/u.test(line))) {
    return { diagnostics: [] };
  }
  const parsed = parseUserSettings(text);
  if (parsed.ok) return { settings: parsed.settings, diagnostics: [] };
  return {
    diagnostics: parsed.diagnostics.map(d =>
      error(
        d.code,
        `~/${USER_SETTINGS_FILE}${d.line === undefined ? "" : `:${d.line}:${d.column ?? 1}`}: ${d.message}`,
        [],
      ),
    ),
  };
};

export type ProjectOptions = {
  project?: Project;
  projectRoot?: string;
  /** The workflow file's folder: project context paths are rebased onto it. */
  workflowDir?: string;
};

const union = (
  ...lists: (readonly string[] | undefined)[]
): string[] | undefined => {
  const all = [...new Set(lists.flatMap(list => list ?? []))];
  return all.length === 0 ? undefined : all;
};

const dropUndefined = <T extends object>(value: T): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same keys, fewer of them
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;

/**
 * The workflow with its project's rules under it: git rules key by key and
 * defaults key by key, practices one by one (the workflow's win), permissions
 * added together, the project's context files before the workflow's, and its
 * heavy commands denied to nodes with `verify:`.
 */
export const applyProject = (
  workflow: Workflow,
  options: ProjectOptions,
): Workflow => {
  const { project } = options;
  if (project === undefined) return workflow;
  const git = dropUndefined({ ...project.git, ...workflow.rules?.git });
  const allow = union(
    project.permissions?.allow,
    workflow.rules?.permissions?.allow,
  );
  const deny = union(
    project.permissions?.deny,
    workflow.rules?.permissions?.deny,
  );
  const permissions = dropUndefined({ allow, deny });
  const rules = dropUndefined({
    links: workflow.rules?.links ?? project.links,
    git: Object.keys(git).length === 0 ? undefined : git,
    permissions:
      Object.keys(permissions).length === 0 ? undefined : permissions,
  });
  const defaults = dropUndefined({
    ...project.defaults,
    ...workflow.defaults,
    practices: layerPractices(
      project.defaults?.practices,
      workflow.defaults?.practices,
    ),
  });
  const root = options.projectRoot;
  const dir = options.workflowDir ?? root;
  const context = union(
    (project.context ?? []).map(file =>
      root === undefined || dir === undefined
        ? file
        : path.relative(dir, path.resolve(root, file)),
    ),
    workflow.layers?.context,
  );
  const layers = dropUndefined({ ...workflow.layers, context });
  return dropUndefined({
    ...workflow,
    nodes: withoutHeavy(workflow.nodes, project.heavy ?? []),
    defaults: Object.keys(defaults).length === 0 ? undefined : defaults,
    rules: Object.keys(rules).length === 0 ? undefined : rules,
    layers: Object.keys(layers).length === 0 ? undefined : layers,
  });
};

export const gitRulesOf = (workflow: Workflow): ResolvedGitRules => {
  const git = workflow.rules?.git ?? {};
  const commit = git.commit ?? "auto";
  return {
    commit,
    merge: git.merge ?? (commit === "never" ? "patch" : "auto"),
    base: git.base ?? "HEAD",
    branch: git.branch ?? DEFAULT_BRANCH_TEMPLATE,
    worktrees: git.worktrees ?? DEFAULT_WORKTREES_TEMPLATE,
  };
};

/** Whether more than one worktree can exist in a run of `workflow`. */
const manyWorktrees = (workflow: Workflow): boolean => {
  let count = 0;
  for (const node of Object.values(workflow.nodes)) {
    if (!isClaudeNode(node)) continue;
    if (node.type === "agent.leader" && (node.maxWorkers ?? 0) > 0) return true;
    const isolation =
      node.isolation ?? workflow.defaults?.isolation ?? "worktree";
    // A fanned node has a worktree for each item (RFC-013).
    const fanned = "forEach" in node && node.forEach !== undefined;
    if (node.type !== "agent.subagent" && isolation === "worktree") {
      count += fanned ? 2 : 1;
    }
  }
  return count > 1;
};

const PATH = ["rules", "git"] as const;

/** Checks the effective workflow's git rules. */
export const checkRules = (workflow: Workflow): Diagnostic[] => {
  const git = gitRulesOf(workflow);
  const inputs = Object.keys(workflow.inputs ?? {});
  const diagnostics: Diagnostic[] = [];
  if (git.commit === "never" && git.merge === "auto") {
    diagnostics.push(
      error(
        "rules.merge",
        "merge: auto needs commits; with commit: never use merge: patch or never",
        [...PATH, "merge"],
      ),
    );
  }
  const named = [
    ["base", git.base],
    ["worktrees", git.worktrees],
    ...(git.commit === "never" ? [] : [["branch", git.branch] as const]),
  ] as const;
  for (const [key, template] of named) {
    for (const problem of templateProblems(template, inputs)) {
      diagnostics.push(
        error("rules.template", `git.${key}: ${problem}`, [...PATH, key]),
      );
    }
  }
  if (path.isAbsolute(git.worktrees) || git.worktrees.startsWith("~")) {
    diagnostics.push(
      error(
        "rules.template",
        "git.worktrees is relative to the clone, beside it (e.g. ../{clone}-worktrees/{node})",
        [...PATH, "worktrees"],
      ),
    );
  }
  const unique = [
    ["worktrees", git.worktrees],
    ...(git.commit === "never" ? [] : [["branch", git.branch] as const]),
  ] as const;
  for (const [key, template] of unique) {
    const names = placeholdersOf(template);
    const what = key === "branch" ? "branch" : "worktree";
    if (!names.includes("node") && manyWorktrees(workflow)) {
      diagnostics.push(
        error(
          "rules.template",
          `git.${key} needs {node}: this workflow can have more than one worktree in a run`,
          [...PATH, key],
        ),
      );
    } else if (!names.includes("run")) {
      diagnostics.push(
        warning(
          "rules.template",
          `git.${key} has no {run}: a second run stops while the first run's ${what} exists`,
          [...PATH, key],
        ),
      );
    }
  }
  return diagnostics;
};
