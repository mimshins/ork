/**
 * @file Scaffolding a project: `.ork/workflows/` with a starter workflow and
 *   the `.gitignore` entry for run state, never overwriting a file; then the
 *   tool folders the project already uses are linked to `.ork/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type EventStore,
  linkTools,
  type ToolLink,
  toolsInUse,
} from "@krapht/ork-core";
import { serializeWorkflow, type Workflow } from "@krapht/ork-schema";

import { WORKFLOW_DIR, WORKFLOW_SUFFIX } from "../workflows.ts";
import { recordInRepo } from "./register.ts";

/** Run state that never belongs in git. */
export const GITIGNORE_ENTRIES = [".ork/runs/"] as const;

export const STARTER: Workflow = {
  schemaVersion: 1,
  name: "hello",
  description:
    "A leader plans the task, a worker does it, and you approve the result.",
  inputs: {
    task: { type: "string", required: true, description: "What to do." },
  },
  defaults: { driver: "sdk", model: "sonnet", isolation: "worktree" },
  limits: { budgetUsd: 5 },
  nodes: {
    lead: {
      type: "claude.leader",
      prompt: "Plan this task and delegate it to your worker: {{inputs.task}}",
      model: "opus",
      maxWorkers: 2,
    },
    worker: {
      type: "claude.worker",
      parent: "lead",
      prompt: "Do the part of the task your owner gives you, then report.",
    },
    approve: {
      type: "human.gate",
      question: "Accept the result on {{nodes.lead.output.branch}}?",
      options: ["accept", "reject"],
      recommended: "accept",
    },
  },
  edges: ["lead -> approve"],
};

/** The run-state entries `root`'s `.gitignore` lacks. */
export const unignored = (root: string): string[] => {
  const gitignore = path.join(root, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  const lines = new Set(current.split("\n").map(line => line.trim()));
  return GITIGNORE_ENTRIES.filter(entry => !lines.has(entry));
};

/** Adds the run-state entries `root`'s `.gitignore` lacks; returns them. */
export const ignoreRunState = (root: string): string[] => {
  const missing = unignored(root);
  if (missing.length === 0) return [];
  const gitignore = path.join(root, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(
    gitignore,
    `${current}${prefix}# Ork run state\n${missing.join("\n")}\n`,
  );
  return missing;
};

export type InitResult = {
  created: string[];
  skipped: string[];
  /** The tool folders linked to `.ork/`, when linking was asked for. */
  links: ToolLink[];
};

/**
 * Scaffolds `.ork/` in `cwd`. Never overwrites an existing file. With `link`,
 * also links the folders of the tools the project already uses
 * (`.claude/agents` and so on) to `.ork/`.
 */
export const initProject = (
  cwd: string,
  options: { link?: boolean } = {},
): InitResult => {
  const created: string[] = [];
  const skipped: string[] = [];

  mkdirSync(path.join(cwd, WORKFLOW_DIR), { recursive: true });
  const starter = path.join(WORKFLOW_DIR, `${STARTER.name}${WORKFLOW_SUFFIX}`);
  if (existsSync(path.join(cwd, starter))) {
    skipped.push(starter);
  } else {
    writeFileSync(path.join(cwd, starter), serializeWorkflow(STARTER));
    created.push(starter);
  }

  const missing = ignoreRunState(cwd);
  if (missing.length > 0) created.push(`.gitignore (${missing.join(", ")})`);
  const linked =
    options.link === true ? linkTools(cwd, toolsInUse(cwd)) : undefined;
  if (linked?.ok !== true) return { created, skipped, links: [] };
  return {
    created: [...created, ...linked.created],
    skipped,
    links: linked.links,
  };
};

/**
 * `ork init`: records the in-repo project at `cwd`, then scaffolds it. An
 * attached project is refused: Ork writes nothing into its repository.
 */
export const initRecorded = (
  store: Pick<EventStore, "projects" | "addProject">,
  cwd: string,
  options: { link?: boolean } = {},
): InitResult | { error: string } => {
  const recorded = recordInRepo(store, cwd);
  return recorded.ok ? initProject(cwd, options) : { error: recorded.error };
};
