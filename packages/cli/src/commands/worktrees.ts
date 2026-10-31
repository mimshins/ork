/**
 * @file `ork worktrees`: lists the worktrees and branches runs left behind
 *   (those the runs recorded creating, whatever the project's git rules named
 *   them, and any `ork/` branch), with their state read from git, and cleans
 *   them up safely after showing the plan and asking.
 */

import { createInterface } from "node:readline/promises";

import {
  applyClean,
  type CleanStep,
  createdWorktrees,
  inspectProject,
  listOrkWorktrees,
  openStore,
  type OrkWorktree,
  planClean,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write } from "../output.ts";

/** One line of state: where it is and what clean would care about. */
export const worktreeState = (item: OrkWorktree): string => {
  const parts: string[] = [];
  if (item.path === null) parts.push("no worktree");
  else if (item.missing) parts.push("missing (prunable)");
  if (item.dirty) parts.push(style("yellow", "uncommitted changes"));
  if (item.branch === undefined) {
    parts.push(
      item.ahead > 0
        ? style(
            "yellow",
            `detached, ${String(item.ahead)} commit(s) on no branch`,
          )
        : "detached, nothing committed",
    );
  } else {
    parts.push(
      item.merged
        ? style("green", "merged")
        : `${String(item.ahead)} commit(s) not merged`,
    );
  }
  if (item.inMainCheckout) parts.push("checked out here");
  return parts.join(" · ");
};

/** A worktree's name: its branch, or its run and node when detached. */
const labelOf = (item: OrkWorktree): string =>
  item.branch ?? `${item.runId}/${item.nodeId} (detached)`;

export const formatWorktrees = (items: readonly OrkWorktree[]): string[] => {
  if (items.length === 0) return ["No Ork worktrees or branches."];
  const width = Math.max(...items.map(i => labelOf(i).length));
  return items.flatMap(item => [
    `${style("bold", labelOf(item).padEnd(width))}  ${worktreeState(item)}`,
    ...(item.path === null ? [] : [`  ${style("dim", item.path)}`]),
  ]);
};

export const formatPlan = (steps: readonly CleanStep[]): string[] =>
  steps.map(step => {
    const actions = [
      ...(step.removeWorktree ? ["remove worktree"] : []),
      ...(step.deleteBranch ? ["delete branch"] : []),
    ];
    const what = actions.length > 0 ? actions.join(" + ") : "keep";
    const why = step.skip === undefined ? "" : style("dim", ` (${step.skip})`);
    return `  ${labelOf(step.item)}: ${what}${why}`;
  });

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

const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
};

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
