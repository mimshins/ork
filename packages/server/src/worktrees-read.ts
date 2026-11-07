/**
 * @file What the Worktrees panel reads, through the same core functions as `ork
 *   worktrees`: the projects Ork knows (registered, or a stored run's), each
 *   one's items with core's words and what Remove… allows, and the plan Clean
 *   merged… would carry out, with a digest of it. A project git can't read
 *   comes back with its error, never as a failed request.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  type CleanStep,
  cleanStep,
  keyOf,
  labelOf,
  mergeStateOf,
  type OrkWorktree,
  planClean,
  planLine,
  type ProjectWorktrees,
  projectHead,
  readWorktrees,
  removeRefusal,
  stateParts,
  stepPrunes,
} from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import type {
  CleanPlanProject,
  WorktreeRow,
  WorktreesProject,
} from "./contract-worktrees.ts";
import { fail } from "./router.ts";

export type Known = { root: string; name: string };

/** Every project Ork knows, by name: registered ones, then runs' others. */
export const knownProjects = (context: ServerContext): Known[] => {
  const names = new Map(context.store.projects().map(p => [p.root, p.id]));
  for (const run of context.store.runs()) {
    if (!names.has(run.project)) {
      names.set(run.project, path.basename(run.project) || run.project);
    }
  }
  return [...names]
    .map(([root, name]) => ({ root, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

type Refusal = { status: 400 | 404 | 409; error: string };

/** The project `root` names, or all of them; only roots Ork knows. */
export const projectsFor = (
  context: ServerContext,
  root: string | undefined,
): { ok: true; projects: Known[] } | { ok: false; refusal: Refusal } => {
  const known = knownProjects(context);
  if (root === undefined) return { ok: true, projects: known };
  const found = known.filter(p => p.root === root);
  return found.length === 0
    ? {
        ok: false,
        refusal: fail(404, `Ork doesn't know a project at ${root}.`),
      }
    : { ok: true, projects: found };
};

export type ReadProject = Known & {
  head: string | null;
  error?: string;
  /** The command that would fix `error`, when there is one. */
  fix?: string;
  worktrees?: ProjectWorktrees;
};

const failed = (known: Known, error: string, fix?: string): ReadProject => ({
  ...known,
  head: null,
  error,
  ...(fix === undefined ? {} : { fix }),
});

/** A project's items and runs still going, or why git couldn't read them. */
export const readProject = async (
  context: ServerContext,
  known: Known,
): Promise<ReadProject> => {
  if (!existsSync(known.root)) {
    // Only a registered project can be pointed at its new place.
    const registered = context.store
      .projects()
      .find(p => p.root === known.root);
    return failed(
      known,
      `its folder ${known.root} is gone.`,
      registered === undefined
        ? undefined
        : `ork projects move ${registered.id} <new path>`,
    );
  }
  const head = await projectHead(known.root);
  if (!head.ok) return failed(known, "Not in a git repository with a commit.");
  try {
    const worktrees = await readWorktrees(context.store, known.root);
    return { ...known, head: head.branch, worktrees };
  } catch (error) {
    return failed(
      known,
      error instanceof Error ? error.message : String(error),
    );
  }
};

const runKnown = (context: ServerContext, id: string): boolean =>
  context.store.lookup(id).some(run => run.id === id);

const rowOf = (
  context: ServerContext,
  item: OrkWorktree,
  live: ReadonlySet<string>,
): WorktreeRow => {
  const going = live.has(item.runId);
  const refusal = removeRefusal(item, going);
  const keeps = item.merged
    ? cleanStep(item, { branches: false, force: false, live }).skip
    : undefined;
  return {
    ...item,
    key: keyOf(item),
    label: labelOf(item),
    state: mergeStateOf(item),
    parts: stateParts(item),
    run: { known: runKnown(context, item.runId), live: going },
    ...(keeps === undefined ? {} : { cleanKeeps: keeps }),
    remove: {
      label: item.path === null ? "Delete branch…" : "Remove…",
      ...(refusal === undefined ? {} : { refusal }),
    },
  };
};

/** A read project as the list shows it. */
export const listed = (
  context: ServerContext,
  read: ReadProject,
): WorktreesProject => {
  const { worktrees, ...rest } = read;
  const live = worktrees?.live ?? new Set<string>();
  return {
    ...rest,
    items: (worktrees?.items ?? []).map(item => rowOf(context, item, live)),
  };
};

/** Clean merged's plan for a read project: never forced. */
export const cleanStepsOf = (
  read: ReadProject,
  branches: boolean,
): CleanStep[] =>
  read.worktrees === undefined
    ? []
    : planClean(
        read.worktrees.items,
        { merged: true },
        { branches, force: false, live: read.worktrees.live },
      );

/** A read project's clean plan as the dialog shows it. */
export const cleanPlanOf = (
  read: ReadProject,
  steps: readonly CleanStep[],
): CleanPlanProject => ({
  root: read.root,
  name: read.name,
  head: read.head,
  ...(read.error === undefined ? {} : { error: read.error }),
  steps: steps.map(step => ({
    key: keyOf(step.item),
    line: planLine(step),
    removeWorktree: step.removeWorktree,
    deleteBranch: step.deleteBranch,
    prunes: stepPrunes(step),
    ...(step.skip === undefined ? {} : { skip: step.skip }),
  })),
});

/** What a person was shown, as a digest an act hands back. */
export const digestOf = (shown: unknown): string =>
  createHash("sha256").update(JSON.stringify(shown)).digest("hex");
