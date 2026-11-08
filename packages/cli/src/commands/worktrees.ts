/**
 * @file `ork worktrees` (or `ork wt`): lists the worktrees and branches runs
 *   left behind (those the runs recorded creating, whatever the project's git
 *   rules named them, and any `ork/` branch), with their state read from git;
 *   cleans them up safely after showing the plan and asking; and removes one,
 *   the twin of the Worktrees panel's Remove…. The plans are core's, so the
 *   panel keeps and removes exactly what these do.
 */

import path from "node:path";

import {
  applyClean,
  applyRemove,
  inspectProject,
  keyOf,
  labelOf,
  lostWork,
  openStore,
  planClean,
  planRemove,
  type ProjectWorktrees,
  readWorktrees,
  stepActs,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, style, write, writeErr } from "../output.ts";
import {
  formatLost,
  formatPlan,
  formatWorktrees,
} from "../project/worktrees.ts";

/** The repo this folder is in, and what Ork created there; null outside one. */
const here = async (): Promise<
  ({ root: string } & ProjectWorktrees) | null
> => {
  const root = (await inspectProject(process.cwd()))?.root ?? null;
  if (root === null) {
    writeErr("Not in a git repository with a commit.");
    process.exitCode = 1;
    return null;
  }
  const store = openStore();
  try {
    return { root, ...(await readWorktrees(store, root)) };
  } finally {
    store.close();
  }
};

/** Asks before acting, unless `--yes`; without a terminal `--yes` is needed. */
const goAhead = (yes: boolean, verb: string): Promise<boolean> => {
  if (yes) return Promise.resolve(true);
  if (!process.stdin.isTTY) {
    writeErr(`Pass --yes to ${verb} without a terminal.`);
    process.exitCode = 1;
    return Promise.resolve(false);
  }
  return confirm("Go ahead? [y/N] ");
};

const done = (lines: readonly string[]): void => {
  for (const line of lines) write(`${style("green", "✓")} ${line}`);
};

const show = async (json: boolean): Promise<void> => {
  const found = await here();
  if (found === null) return;
  if (json) write(JSON.stringify(found.items, undefined, 2));
  else for (const line of formatWorktrees(found.items)) write(line);
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

const yes = {
  type: "boolean",
  description: "Do not ask",
  default: false,
} as const;

const clean = defineCommand({
  meta: {
    name: "clean",
    description:
      "Remove Ork's worktrees (merged ones by default); never one with uncommitted changes unless --force, nor one whose run is still going",
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
    yes,
  },
  run: async ({ args }) => {
    const found = await here();
    if (found === null) return;
    const filter: Parameters<typeof planClean>[1] = { merged: !args.all };
    if (args.run !== undefined) filter.runId = args.run;
    const steps = planClean(found.items, filter, {
      branches: args.branches,
      force: args.force,
      live: found.live,
    });
    const acting = steps.filter(s => stepActs(s));
    if (acting.length === 0) {
      for (const line of formatPlan(steps)) write(line);
      write("Nothing to clean.");
      return;
    }
    write("Plan:");
    for (const line of formatPlan(steps)) write(line);
    if (!(await goAhead(args.yes, "clean"))) return;
    done(await applyClean(found.root, acting, args.force));
  },
});

const remove = defineCommand({
  meta: {
    name: "remove",
    description:
      "Remove one of Ork's worktrees, by its branch or its path; --force when that loses work",
  },
  args: {
    target: {
      type: "positional",
      description: "The branch, or the worktree's path",
      required: true,
    },
    branch: {
      type: "boolean",
      description: "Also delete the branch",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Remove even when that loses uncommitted changes or commits",
      default: false,
    },
    yes,
  },
  run: async ({ args }) => {
    const found = await here();
    if (found === null) return;
    const byPath = path.resolve(args.target);
    const item = found.items.find(
      i =>
        keyOf(i) === args.target ||
        labelOf(i) === args.target ||
        i.path === byPath,
    );
    const planned = planRemove(
      found,
      item === undefined ? args.target : keyOf(item),
      args.branch,
    );
    if (!planned.ok) {
      writeErr(planned.error);
      process.exitCode = 1;
      return;
    }
    const { plan } = planned;
    write("Plan:");
    for (const line of formatPlan([plan.step])) write(line);
    if (plan.force) {
      for (const line of formatLost(await lostWork(found.root, plan))) {
        write(line);
      }
      if (!args.force) {
        writeErr("That loses work; pass --force to remove it anyway.");
        process.exitCode = 1;
        return;
      }
    }
    if (!(await goAhead(args.yes, "remove"))) return;
    done(await applyRemove(found.root, plan));
  },
});

export const worktrees = defineCommand({
  meta: {
    name: "worktrees",
    description: "Track and clean up the git worktrees Ork creates for runs",
  },
  subCommands: { list, clean, remove },
  run: async ({ rawArgs }) => {
    // citty runs this after a subcommand too; only list on a bare call.
    const [first] = rawArgs;
    if (first === "list" || first === "clean" || first === "remove") return;
    await show(rawArgs.includes("--json"));
  },
});
