/**
 * @file The Worktrees panel's routes (specs/worktrees.md), through the same
 *   core functions as `ork worktrees`: the list for every project Ork knows
 *   (read in parallel, a project git can't read carrying its error), Remove…
 *   (worktrees-remove.ts), and Clean merged…, which only ever cleans what's
 *   merged, never forced, and goes ahead only when its plan's digest is the one
 *   the person saw. A project takes one write at a time.
 */

import { applyClean, stepActs } from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import type { CleanDone } from "./contract-worktrees.ts";
import { fail, type Handlers, ok } from "./router.ts";
import {
  cleanPlanOf,
  cleanStepsOf,
  digestOf,
  listed,
  projectsFor,
  type ReadProject,
  readProject,
} from "./worktrees-read.ts";
import { removeIt, removePlanOf } from "./worktrees-remove.ts";

type WorktreesRoutes = Pick<
  Handlers,
  | "worktrees"
  | "worktreeRemovePlan"
  | "worktreeRemove"
  | "worktreesCleanPlan"
  | "worktreesClean"
>;

const PLAN_CHANGED =
  "The plan changed since you read it. Read it again before cleaning.";

/** Carries out one project's part of a clean; what it did, and where it stopped. */
const cleanOne = async (
  read: ReadProject,
  branches: boolean,
): Promise<CleanDone> => {
  const done: string[] = [];
  const acting = cleanStepsOf(read, branches).filter(step => stepActs(step));
  try {
    if (acting.length > 0) await applyClean(read.root, acting, false, done);
    return { root: read.root, name: read.name, done };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { root: read.root, name: read.name, done, error: why };
  }
};

export const worktreesRoutes = (context: ServerContext): WorktreesRoutes => {
  /** The projects a remove or clean is writing to now. */
  const busy = new Set<string>();
  const readAll = async (project: string | undefined) => {
    const found = projectsFor(context, project);
    if (!found.ok) return found;
    const reads = await Promise.all(
      found.projects.map(known => readProject(context, known)),
    );
    return { ok: true as const, reads };
  };
  const cleanPlan = async (body: {
    project?: string | undefined;
    branches: boolean;
  }) => {
    const all = await readAll(body.project);
    if (!all.ok) return all;
    const projects = all.reads.map(read =>
      cleanPlanOf(read, cleanStepsOf(read, body.branches)),
    );
    return {
      ok: true as const,
      reads: all.reads,
      projects,
      digest: digestOf(projects),
    };
  };
  return {
    worktrees: async ({ query }) => {
      const all = await readAll(query.project);
      if (!all.ok) return all.refusal;
      return ok({ projects: all.reads.map(read => listed(context, read)) });
    },

    worktreeRemovePlan: async ({ body }) => {
      const planned = await removePlanOf(context, body);
      return planned.ok ? ok(planned.answer) : planned.refusal;
    },

    worktreeRemove: async ({ body }) => {
      const removed = await removeIt(context, body, busy);
      return removed.ok ? ok({ done: removed.done }) : removed.refusal;
    },

    worktreesCleanPlan: async ({ body }) => {
      const planned = await cleanPlan(body);
      if (!planned.ok) return planned.refusal;
      return ok({ projects: planned.projects, digest: planned.digest });
    },

    worktreesClean: async ({ body }) => {
      const taken = projectsFor(context, body.project);
      if (!taken.ok) return taken.refusal;
      const held = taken.projects.find(p => busy.has(p.root));
      if (held !== undefined) {
        return fail(
          409,
          `A remove or clean is already running in ${held.name}.`,
        );
      }
      const roots = taken.projects.map(p => p.root);
      for (const root of roots) busy.add(root);
      try {
        const planned = await cleanPlan(body);
        if (!planned.ok) return planned.refusal;
        if (planned.digest !== body.digest) return fail(409, PLAN_CHANGED);
        const projects: CleanDone[] = [];
        for (const read of planned.reads) {
          // oxlint-disable-next-line no-await-in-loop -- one project at a time, in the plan's order
          projects.push(await cleanOne(read, body.branches));
        }
        return ok({ projects });
      } finally {
        for (const root of roots) busy.delete(root);
      }
    },
  };
};
