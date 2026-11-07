/**
 * @file Remove… for one item, the twin of `ork worktrees remove`: the plan by
 *   core's rule with what it would lose, as git prints it, and a digest of
 *   both; then the removal, which plans again and goes ahead only when the
 *   digest is the one the person saw, and forces only a plan that needed it.
 *   What to remove is resolved from a fresh listing, never a path sent in.
 */

import {
  applyRemove,
  lostWork,
  planLine,
  planRemove,
  type RemovePlan,
  stepPrunes,
} from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import type { Losing, RemovePlanAnswer } from "./contract-worktrees.ts";
import { fail } from "./router.ts";
import {
  digestOf,
  type Known,
  projectsFor,
  readProject,
} from "./worktrees-read.ts";

/** How many of git's lines a well shows; the rest are counted. */
const SHOWN_LINES = 20;

type Refusal = { status: 400 | 404 | 409; error: string };

type Refused = { ok: false; refusal: Refusal };

type Ask = { project: string; key: string; deleteBranch: boolean };

export type Planned = {
  ok: true;
  known: Known;
  plan: RemovePlan;
  answer: RemovePlanAnswer;
};

const firstOf = (all: readonly string[]): string[] => all.slice(0, SHOWN_LINES);

const moreOf = (all: readonly string[]): number =>
  Math.max(0, all.length - SHOWN_LINES);

/** One item's remove plan, as the dialog shows it, or why there's none. */
export const removePlanOf = async (
  context: ServerContext,
  ask: Ask,
): Promise<Planned | Refused> => {
  const found = projectsFor(context, ask.project);
  if (!found.ok) return found;
  const [known] = found.projects;
  if (known === undefined)
    return { ok: false, refusal: fail(404, "No project.") };
  const read = await readProject(context, known);
  if (read.worktrees === undefined) {
    const why = `Could not read ${known.name}'s worktrees: ${read.error ?? ""}`;
    return { ok: false, refusal: fail(400, why) };
  }
  const planned = planRemove(read.worktrees, ask.key, ask.deleteBranch);
  if (!planned.ok) {
    return {
      ok: false,
      refusal: fail(planned.gone ? 404 : 400, planned.error),
    };
  }
  const { plan } = planned;
  const lost = await lostWork(known.root, plan);
  const losing: Losing = {
    changes: firstOf(lost.changes),
    commits: firstOf(lost.commits),
    commitsOn: lost.commitsOn,
    more: { changes: moreOf(lost.changes), commits: moreOf(lost.commits) },
  };
  const { step } = plan;
  return {
    ok: true,
    known,
    plan,
    answer: {
      line: planLine(step),
      removeWorktree: step.removeWorktree,
      deleteBranch: step.deleteBranch,
      prunes: stepPrunes(step) && !step.removeWorktree,
      force: plan.force,
      losing,
      digest: digestOf({ step, force: plan.force, lost }),
    },
  };
};

export const CHANGED =
  "It changed since you read it. Read it again before removing.";

/** Removes the item when its plan is still the one shown as `digest`. */
export const removeIt = async (
  context: ServerContext,
  ask: Ask & { force: boolean; digest: string },
  busy: Set<string>,
): Promise<{ ok: true; done: string[] } | Refused> => {
  if (busy.has(ask.project)) {
    const name = projectsFor(context, ask.project);
    const called = name.ok
      ? (name.projects[0]?.name ?? ask.project)
      : ask.project;
    return {
      ok: false,
      refusal: fail(409, `A remove or clean is already running in ${called}.`),
    };
  }
  busy.add(ask.project);
  try {
    const planned = await removePlanOf(context, ask);
    if (!planned.ok) return planned;
    if (planned.answer.digest !== ask.digest) {
      return { ok: false, refusal: fail(409, CHANGED) };
    }
    if (planned.plan.force && !ask.force) {
      return {
        ok: false,
        refusal: fail(400, "That loses work: confirm what's lost first."),
      };
    }
    const done: string[] = [];
    try {
      await applyRemove(planned.known.root, planned.plan, done);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { ok: false, refusal: fail(400, why) };
    }
    return { ok: true, done };
  } finally {
    busy.delete(ask.project);
  }
};
