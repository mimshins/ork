/**
 * @file A project's rules at compile time: reading `.ork/project.yaml`, merging
 *   it under the workflow (the workflow's `rules:`, `defaults` and context
 *   win), resolving the git rules with Ork's defaults, and checking them:
 *   placeholders, names unique per run, and a merge that fits the commit rule.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_BRANCH_TEMPLATE,
  DEFAULT_WORKTREES_TEMPLATE,
  type Diagnostic,
  type ResolvedGitRules,
  isClaudeNode,
  parseProject,
  type Project,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "../graph/diagnostics.ts";
import { placeholdersOf, templateProblems } from "./templates.ts";

/** Where an in-repo project keeps its rules. */
export const PROJECT_FILE = ".ork/project.yaml";

export type LoadedProject = {
  /** The project's rules, or `undefined` when it has no (valid) file. */
  project?: Project;
  /** Problems in the file, located in it (`.ork/project.yaml:3:5: …`). */
  diagnostics: Diagnostic[];
};

/** Reads `file` (by default the project's `.ork/project.yaml`), if it exists. */
export const loadProject = (
  projectRoot: string,
  file: string = path.join(projectRoot, PROJECT_FILE),
): LoadedProject => {
  if (!existsSync(file)) return { diagnostics: [] };
  const parsed = parseProject(readFileSync(file, "utf8"));
  if (parsed.ok) return { project: parsed.project, diagnostics: [] };
  const label = path.relative(projectRoot, file);
  return {
    diagnostics: parsed.diagnostics.map(d => {
      const at = d.line === undefined ? "" : `:${d.line}:${d.column ?? 1}`;
      return error(d.code, `${label}${at}: ${d.message}`, []);
    }),
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
 * defaults key by key (the workflow's win), permissions added together, and the
 * project's context files before the workflow's.
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
    git: Object.keys(git).length === 0 ? undefined : git,
    permissions:
      Object.keys(permissions).length === 0 ? undefined : permissions,
  });
  const defaults = dropUndefined({ ...project.defaults, ...workflow.defaults });
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
    if (node.type === "claude.leader" && (node.maxWorkers ?? 0) > 0)
      return true;
    const isolation =
      node.isolation ?? workflow.defaults?.isolation ?? "worktree";
    if (node.type !== "claude.subagent" && isolation === "worktree") count += 1;
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
