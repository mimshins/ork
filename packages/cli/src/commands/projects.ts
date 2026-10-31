/**
 * @file A project's bookkeeping. `ork register` attaches a project from outside
 *   its repository and `ork projects` lists or forgets registered ones
 *   (ADR-035); neither writes into a repository. `ork migrate` moves an
 *   attached project into its repository, brings its agents and skills under
 *   `.ork/`, or drafts a workflow from its agents (ADR-036), and commits
 *   nothing. `ork worktrees` lists the worktrees and branches runs left behind
 *   (those the runs recorded creating, whatever the project's git rules named
 *   them, and any `ork/` branch), with their state read from git, and cleans
 *   them up safely after showing the plan and asking.
 */

import {
  applyClean,
  createdWorktrees,
  inspectProject,
  listOrkWorktrees,
  openStore,
  type OrkWorktree,
  planClean,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, style, write, writeErr } from "../output.ts";
import { draftHere } from "../project/draft.ts";
import { migrateHere } from "../project/migrate.ts";
import {
  formatProject,
  formatRegistered,
  registerProject,
} from "../project/register.ts";
import { formatPlan, formatWorktrees } from "../project/worktrees.ts";
import { formatReport, validateFile } from "./validate.ts";

const projectRoot = async (): Promise<string | null> =>
  (await inspectProject(process.cwd()))?.root ?? null;

/** What Ork created in the repo at `root`, from its runs' records and git. */
const itemsIn = async (root: string): Promise<OrkWorktree[]> => {
  const store = openStore();
  try {
    return await listOrkWorktrees(root, createdWorktrees(store, root));
  } finally {
    store.close();
  }
};

const notGit = () => {
  process.stderr.write("Not in a git repository with a commit.\n");
  process.exitCode = 1;
};

const show = async (json: boolean): Promise<void> => {
  const root = await projectRoot();
  if (root === null) {
    notGit();
    return;
  }
  const items = await itemsIn(root);
  if (json) write(JSON.stringify(items, undefined, 2));
  else for (const line of formatWorktrees(items)) write(line);
};

const list = defineCommand({
  meta: {
    name: "list",
    description: "List Ork's worktrees and branches (the default)",
  },
  args: {
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) => show(args.json),
});

const clean = defineCommand({
  meta: {
    name: "clean",
    description:
      "Remove Ork's worktrees (merged ones by default); never one with uncommitted changes unless --force",
  },
  args: {
    run: { type: "string", description: "Only this run's worktrees" },
    all: {
      type: "boolean",
      description: "Include worktrees whose branch is not merged",
      default: false,
    },
    branches: {
      type: "boolean",
      description: "Also delete the branches",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Remove uncommitted changes and unmerged branches too",
      default: false,
    },
    yes: { type: "boolean", description: "Do not ask", default: false },
  },
  run: async ({ args }) => {
    const root = await projectRoot();
    if (root === null) {
      notGit();
      return;
    }
    const filter: Parameters<typeof planClean>[1] = { merged: !args.all };
    if (args.run !== undefined) filter.runId = args.run;
    const steps = planClean(await itemsIn(root), filter, {
      branches: args.branches,
      force: args.force,
    });
    const acting = steps.filter(s => s.removeWorktree || s.deleteBranch);
    if (steps.length === 0 || acting.length === 0) {
      for (const line of formatPlan(steps)) write(line);
      write("Nothing to clean.");
      return;
    }
    write("Plan:");
    for (const line of formatPlan(steps)) write(line);
    if (!args.yes) {
      if (!process.stdin.isTTY) {
        process.stderr.write("Pass --yes to clean without a terminal.\n");
        process.exitCode = 1;
        return;
      }
      if (!(await confirm("Go ahead? [y/N] "))) return;
    }
    for (const line of await applyClean(root, acting, args.force)) {
      write(`${style("green", "✓")} ${line}`);
    }
  },
});

export const worktrees = defineCommand({
  meta: {
    name: "worktrees",
    description: "Track and clean up the git worktrees Ork creates for runs",
  },
  subCommands: { list, clean },
  run: async ({ rawArgs }) => {
    // citty runs this after a subcommand too; only list on a bare call.
    const [first] = rawArgs;
    if (first === "list" || first === "clean") return;
    await show(rawArgs.includes("--json"));
  },
});

const json = {
  type: "boolean",
  description: "Print JSON",
  default: false,
} as const;

/** Runs `use` with the store open, and closes it. */
const withStore = <T>(use: (store: ReturnType<typeof openStore>) => T): T => {
  const store = openStore();
  try {
    return use(store);
  } finally {
    store.close();
  }
};

export const register = defineCommand({
  meta: {
    name: "register",
    description:
      "Attach a project from outside it: its workflows, rules and runs live in ~/.ork/projects/<id>/, nothing in the repository",
  },
  args: {
    path: {
      type: "positional",
      description: "The repository (default: this folder)",
      required: false,
    },
    id: {
      type: "string",
      description: "The project's id (default: its folder's name)",
    },
    json,
  },
  run: ({ args }) => {
    const result = withStore(store =>
      registerProject(
        store,
        args.path ?? process.cwd(),
        args.id === undefined ? {} : { id: args.id },
      ),
    );
    if (!result.ok) {
      writeErr(result.error);
      process.exitCode = 1;
    } else if (args.json) {
      write(JSON.stringify(result.project, undefined, 2));
    } else {
      for (const line of formatRegistered(result.project, result.created)) {
        write(line);
      }
    }
  },
});

const forget = defineCommand({
  meta: {
    name: "forget",
    description: "Forget a registered project; its files and runs are kept",
  },
  args: {
    id: { type: "positional", description: "The project's id", required: true },
  },
  run: ({ args }) => {
    if (withStore(store => store.forgetProject(args.id))) {
      write(`${style("green", "forgot")} ${args.id} (its files are kept)`);
      return;
    }
    writeErr(`No project is registered as ${args.id}.`);
    process.exitCode = 1;
  },
});

export const projects = defineCommand({
  meta: {
    name: "projects",
    description: "List the registered projects, in-repo and attached",
  },
  args: { json },
  subCommands: { forget },
  run: ({ args, rawArgs }) => {
    // citty runs this after a subcommand too; only list on a bare call.
    if (rawArgs[0] === "forget") return;
    const all = withStore(store => store.projects());
    if (args.json) write(JSON.stringify(all, undefined, 2));
    else if (all.length === 0) {
      write(
        "No projects registered yet: ork init (in-repo) or ork register (attached).",
      );
    } else
      for (const project of all)
        for (const line of formatProject(project)) write(line);
  },
});

export const migrate = defineCommand({
  meta: {
    name: "migrate",
    description:
      "Move an attached project into its repository's .ork/ (--agents: also its agents and skills); --from-agents drafts a workflow. Commits nothing",
  },
  args: {
    agents: {
      type: "boolean",
      description:
        "Also move the agents and skills the tools' folders hold into .ork/, and link the folders to it",
      default: false,
    },
    "from-agents": {
      type: "string",
      description:
        "Only draft a workflow: these agents in order (a,b), each in its worktree",
    },
    reviewer: {
      type: "string",
      description: "With --from-agents: the agent that reviews the last one",
    },
    name: {
      type: "string",
      description: "With --from-agents: the workflow's name",
      default: "process",
    },
    "dry-run": {
      type: "boolean",
      description: "Only show the plan",
      default: false,
    },
    yes: { type: "boolean", description: "Do not ask", default: false },
  },
  run: async ({ args }) => {
    if (args["from-agents"] === undefined) {
      await migrateHere(process.cwd(), {
        agents: args.agents,
        dryRun: args["dry-run"],
        yes: args.yes,
      });
    } else {
      draftHere(process.cwd(), { ...args, from: args["from-agents"] }, file =>
        formatReport(validateFile(file, process.cwd())),
      );
    }
  },
});
