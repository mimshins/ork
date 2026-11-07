/**
 * @file Scaffolding a project: `.ork/workflows/` with a starter workflow and
 *   the `.gitignore` entry for run state, never overwriting a file; then the
 *   tool folders the project already uses are linked to `.ork/`. The starter
 *   names no driver, as it is committed: a run takes the one ready on the
 *   machine running it, and `ork init` says which that is here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type EventStore,
  linkTools,
  loadProject,
  PROJECT_FILE,
  type ToolLink,
  toolsInUse,
} from "@krapht/ork-core";
import {
  type DriverCheck,
  driverChecks,
  type Env,
  type Exec,
  PREFERRED_DRIVER,
  readyDriver,
} from "@krapht/ork-integrations";
import { serializeWorkflow, type Workflow } from "@krapht/ork-schema";

import { exec } from "../doctor/checks.ts";
import { WORKFLOW_DIR, WORKFLOW_SUFFIX } from "../workflows.ts";
import { recordInRepo } from "./register.ts";

/** Run state that never belongs in git. */
export const GITIGNORE_ENTRIES = [".ork/runs/"] as const;

const STARTER_NAME = "hello";

/** Where `ork init` writes the starter, relative to the project root. */
export const STARTER_FILE = path.join(
  WORKFLOW_DIR,
  `${STARTER_NAME}${WORKFLOW_SUFFIX}`,
);

/**
 * The starter workflow. It names no driver: it is committed, and one person's
 * login doesn't belong in a shared file.
 */
export const starterWorkflow = (): Workflow => ({
  schemaVersion: 1,
  name: STARTER_NAME,
  description:
    "A leader plans the task, a worker does it, and you approve the result.",
  inputs: {
    task: { type: "string", required: true, description: "What to do." },
  },
  defaults: { model: "sonnet", isolation: "worktree" },
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
});

/**
 * What `ork init` says of drivers, in one line: the project's `defaults.driver`
 * when it names one, else the driver a run would take here, the one ready
 * (`cli` when both are), or how to get one ready.
 */
export const driverLine = (
  checks: readonly DriverCheck[],
  projectDefault?: string,
): string => {
  if (projectDefault !== undefined) {
    return `Runs use the ${projectDefault} driver, ${PROJECT_FILE}'s default, unless a workflow names another.`;
  }
  const ready = readyDriver(checks);
  if (ready.ok) {
    const why =
      ready.ready === 1
        ? ready.detail
        : `more than one is ready, and ${ready.driver} comes first`;
    return `Runs use the driver that's ready when they start: ${ready.driver} here (${why}).`;
  }
  const hint = checks.find(({ id }) => id === PREFERRED_DRIVER)?.result.hint;
  return `Runs use the driver that's ready when they start, and none is ready here yet: ${hint ?? "see `ork doctor`."}`;
};

/**
 * The line for the project at `root`: `ork doctor`'s driver checks through
 * `run` and `env`, and the project's own default.
 */
export const initDriverLine = async (
  run: Exec,
  env: Env,
  root: string,
): Promise<string> => {
  const projectDefault = loadProject(root).project?.defaults?.driver;
  // A project that names a driver needs no check.
  return driverLine(
    projectDefault === undefined ? await driverChecks(run, env) : [],
    projectDefault,
  );
};

/**
 * The line for a starter about to be written in `root`, with the real tools and
 * environment; `null` when the starter is already there.
 */
export const initDriverLineHere = (root: string): Promise<string | null> =>
  existsSync(path.join(root, STARTER_FILE))
    ? Promise.resolve(null)
    : initDriverLine(exec, process.env, root);

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

export type InitOptions = {
  /** Link the tool folders the project uses to `.ork/`. */
  link?: boolean;
};

/**
 * Scaffolds `.ork/` in `cwd`. Never overwrites an existing file. With `link`,
 * also links the folders of the tools the project already uses
 * (`.claude/agents` and so on) to `.ork/`.
 */
export const initProject = (
  cwd: string,
  options: InitOptions = {},
): InitResult => {
  const created: string[] = [];
  const skipped: string[] = [];

  mkdirSync(path.join(cwd, WORKFLOW_DIR), { recursive: true });
  if (existsSync(path.join(cwd, STARTER_FILE))) {
    skipped.push(STARTER_FILE);
  } else {
    writeFileSync(
      path.join(cwd, STARTER_FILE),
      serializeWorkflow(starterWorkflow()),
    );
    created.push(STARTER_FILE);
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
  options: InitOptions = {},
): InitResult | { error: string } => {
  const recorded = recordInRepo(store, cwd);
  return recorded.ok ? initProject(cwd, options) : { error: recorded.error };
};
