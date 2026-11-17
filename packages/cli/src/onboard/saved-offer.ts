/**
 * @file The offer `ork onboard` makes when a proposal was left at the pick
 *   (specs/cli/onboard-saved.md): its age, and a question whose "yes" skips the
 *   questions and the paid propose run; or, when the newest propose run did not
 *   finish, a question whose "yes" resumes that run. Also the shapes the flow's
 *   ways to a proposal share.
 */

import { ago } from "../runs/format.ts";
import { confirmOrStop } from "../term/confirm.ts";
import { capsOfOnboard, proposeCap, writeCap } from "./caps.ts";
import type { OnboardOptions } from "./options.ts";
import type { Proposed } from "./pick.ts";
import { type Resumed, spentLine } from "./runs.ts";
import {
  findSavedProposal,
  findUnfinishedPropose,
  type UnfinishedProposal,
} from "./saved.ts";

/** A proposal to pick from: its inputs, and the run that holds it. */
export type Proposal = {
  survey: string;
  answers: string;
  proposed: Proposed;
  run: { id: string; spent: string };
};

/** A step's way out of the flow, or what it found. */
export type Step<T> = { stop: { lines: readonly string[]; code: number } } | T;

export const stopWith = (
  lines: readonly string[],
  code: number,
): { stop: { lines: readonly string[]; code: number } } => ({
  stop: { lines, code },
});

/** The exit code for a person's Ctrl-C. */
export const INTERRUPTED = 130;

/** An unfinished propose run the person chose to resume, and its stored inputs. */
export type ToResume = { resume: Resumed; survey: string; answers: string };

/** The unfinished propose run when there is one and the person resumes it. */
const unfinishedProposal = async (
  o: OnboardOptions,
  unfinished: UnfinishedProposal,
  priced: boolean,
  out: (line: string) => void,
): Promise<Step<ToResume> | null> => {
  const { run } = unfinished;
  out(
    `An unfinished proposal from ${ago(unfinished.at)} (run ${run.id}, ${unfinished.status}) can be resumed.`,
  );
  const use = await confirmOrStop(o.io, {
    question: `Resume it, and skip the questions? Spent so far ${spentLine(run)}; it can spend up to ${proposeCap(capsOfOnboard(), priced)} in total.`,
  });
  if (use === null) return stopWith([], INTERRUPTED);
  if (!use) return null;
  const { survey, answers } = unfinished;
  return {
    resume: { runId: run.id, resume: unfinished.resume },
    survey,
    answers,
  };
};

/**
 * The saved proposal, or the unfinished propose run, when there is one and the
 * person takes it; `null` for none, or a "no" (the flow starts as on a first
 * visit), or `--fresh`. The newest propose run decides which is offered.
 */
export const savedProposal = async (
  o: OnboardOptions,
  root: string,
  priced: boolean,
  out: (line: string) => void,
): Promise<Step<Proposal | ToResume> | null> => {
  if (o.fresh) return null;
  const unfinished = findUnfinishedPropose(o.store, root);
  if (unfinished !== null) {
    return unfinishedProposal(o, unfinished, priced, out);
  }
  const saved = findSavedProposal(o.store, root);
  if (saved === null) return null;
  out(
    `A proposal from ${ago(saved.at)} is saved (run ${saved.run.id}); it was read from the files as they were then.`,
  );
  const use = await confirmOrStop(o.io, {
    question: `Use it, and skip the questions and the proposing run? Writing then costs at most ${writeCap(capsOfOnboard(), priced)}.`,
  });
  if (use === null) return stopWith([], INTERRUPTED);
  if (!use) return null;
  return {
    survey: saved.survey,
    answers: saved.answers,
    proposed: saved.proposed,
    run: { id: saved.run.id, spent: spentLine(saved.run) },
  };
};
