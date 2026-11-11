/**
 * @file A project's bookkeeping. `ork register` attaches a project from outside
 *   its repository, and `ork projects` lists registered ones, forgets one, or
 *   follows its moved clone (ADR-035); none writes into a repository. `ork
 *   migrate` moves an attached project into its repository, brings its agents
 *   and skills under `.ork/`, or drafts a workflow from its agents (ADR-036),
 *   and commits nothing. `ork worktrees` is worktrees.ts.
 */

import { defineCommand } from "citty";

import { write, writeErr } from "../output.ts";
import { draftHere } from "../project/draft.ts";
import { migrateHere } from "../project/migrate.ts";
import {
  formatProjects,
  formatRegistered,
  registerProject,
} from "../project/register.ts";
import { forget, move, withStore } from "./project-records.ts";
import { formatReport, validateFile } from "./validate.ts";

const json = {
  type: "boolean",
  description: "Print JSON",
  default: false,
} as const;

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

export const projects = defineCommand({
  meta: {
    name: "projects",
    description: "List the registered projects, in-repo and attached",
  },
  args: { json },
  subCommands: { forget, move },
  run: ({ args, rawArgs }) => {
    // citty runs this after a subcommand too; only list on a bare call.
    if (rawArgs[0] === "forget" || rawArgs[0] === "move") return;
    const all = withStore(store => store.projects());
    if (args.json) write(JSON.stringify(all, undefined, 2));
    else if (all.length === 0) {
      write(
        "No projects registered yet: ork init (in-repo) or ork register (attached).",
      );
    } else for (const line of formatProjects(all)) write(line);
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
