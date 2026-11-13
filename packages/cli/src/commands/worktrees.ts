/**
 * @file `ork worktrees` (or `ork wt`): lists the worktrees and branches runs
 *   left behind (those the runs recorded creating, whatever the project's git
 *   rules named them, and any `ork/` branch), with their state read from git;
 *   cleans them up safely after showing the plan and asking; and removes one,
 *   the twin of the Worktrees panel's Remove…. The plans are core's, so the
 *   panel keeps and removes exactly what these do.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

import {
  applyClean,
  applyRemove,
  applyFilters,
  inspectProject,
  keyOf,
  labelOf,
  lostWork,
  openStore,
  type OrkWorktree,
  planClean,
  planRemove,
  type ProjectWorktrees,
  readWorktrees,
  repoRoot,
  stepActs,
  worktreeListTable,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  filterArgs,
  projectScope,
  readListArgs,
  refuseUnknownFlags,
  resolveRun,
} from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { style, write, writeErr } from "../output.ts";
import { goAhead } from "../project/go-ahead.ts";
import {
  formatLost,
  formatLosses,
  formatPlan,
  formatWorktrees,
  inProjects,
} from "../project/worktrees.ts";
import { withStore } from "./project-records.ts";

type Found = { root: string; runs: string[] } & ProjectWorktrees;

/**
 * The repo this folder is in, and what Ork created there; null outside one. A
 * repo with no commit has nothing of Ork's, which only a read says as an empty
 * list.
 */
const here = async (emptyWithoutCommit = false): Promise<Found | null> => {
  const cwd = process.cwd();
  const root = (await inspectProject(cwd))?.root ?? null;
  if (root === null) {
    const bare = emptyWithoutCommit ? await repoRoot(cwd) : null;
    if (bare !== null) {
      return { root: bare, items: [], live: new Set(), runs: [] };
    }
    writeErr("Not in a git repository with a commit.");
    process.exitCode = 1;
    return null;
  }
  const store = openStore();
  try {
    return {
      root,
      runs: store.runs({ project: root }).map(run => run.id),
      ...(await readWorktrees(store, root)),
    };
  } finally {
    store.close();
  }
};

const realOr = (target: string): string => {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
};

const done = (lines: readonly string[]): void => {
  for (const line of lines) write(`${style("green", "✓")} ${line}`);
};

const show = async (args: Readonly<Record<string, unknown>>): Promise<void> => {
  const request = readListArgs(worktreeListTable, args);
  if (request === undefined) return;
  const projects = withStore(store => store.projects());
  const scope = projectScope(request.filter, projects);
  if (scope === undefined) return;
  const filter = withStore(store => resolveRun(store, request.filter));
  if (filter === undefined) return;
  let items: OrkWorktree[];
  if (scope === "here") {
    const found = await here(true);
    if (found === null) return;
    items = found.items;
  } else {
    items = await inProjects(
      scope === "all" ? projects.map(p => p.root) : [scope.root],
    );
  }
  const shown = applyFilters(worktreeListTable, items, filter).slice(
    0,
    request.limit,
  );
  printList(shown, worktreeListTable, args, rows => {
    for (const line of formatWorktrees(rows)) write(line);
  });
};

const listArgs = filterArgs(worktreeListTable);

const list = defineCommand({
  meta: {
    name: "list",
    description: "List Ork's worktrees and branches (the default)",
  },
  plugins: [refuseUnknownFlags],
  args: listArgs,
  run: ({ args }) => show(args),
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
    const [name] = args._;
    if (name !== undefined) {
      writeErr(
        `\`clean\` takes no name (got ${name}); to remove one worktree: ork worktrees remove ${name}`,
      );
      process.exitCode = 1;
      return;
    }
    const found = await here();
    if (found === null) return;
    const filter: Parameters<typeof planClean>[1] = { merged: !args.all };
    if (args.run !== undefined) {
      const runId = found.runs.find(id => id === args.run);
      if (runId === undefined) {
        writeErr(`No run ${args.run} in this project.`);
        process.exitCode = 1;
        return;
      }
      filter.runId = runId;
    }
    const steps = planClean(found.items, filter, {
      branches: args.branches,
      force: args.force,
      live: found.live,
    });
    const acting = steps.filter(s => stepActs(s));
    if (acting.length === 0) {
      // A plan of keeps explains itself; only an empty one needs saying.
      for (const line of formatPlan(steps)) write(line);
      if (steps.length === 0) write("Nothing to clean.");
      return;
    }
    write("Plan:");
    for (const line of formatPlan(steps)) write(line);
    if (args.force) {
      const losses = await Promise.all(
        acting.map(async step => ({
          item: step.item,
          lost: await lostWork(found.root, { step, force: true }),
        })),
      );
      for (const line of formatLosses(losses)) write(line);
    }
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
    // git lists real paths; the user may have typed a symlinked one.
    const paths = new Set([byPath, realOr(byPath)]);
    const item = found.items.find(
      i =>
        keyOf(i) === args.target ||
        labelOf(i) === args.target ||
        (i.path !== null && paths.has(i.path)),
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
  args: listArgs,
  subCommands: { list, clean, remove },
  run: async ({ args, rawArgs }) => {
    // citty runs this after a subcommand too; only list on a bare call.
    const [first] = rawArgs;
    if (first === "list" || first === "clean" || first === "remove") return;
    await show(args);
  },
});
