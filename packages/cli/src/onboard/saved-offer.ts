/**
 * @file The offer `ork onboard` makes when a proposal was left at the pick
 *   (specs/cli/onboard-flow.md#a-saved-proposal): its age, and a question whose
 *   "yes" skips the questions and the paid propose run. Also the shapes the
 *   flow's two ways to a proposal share.
 */

import { ago } from "../runs/format.ts";
import { confirmOrStop } from "../term/confirm.ts";
import { capsOfOnboard, writeCap } from "./caps.ts";
import type { OnboardOptions } from "./options.ts";
import type { Proposed } from "./pick.ts";
import { spentLine } from "./runs.ts";
import { findSavedProposal } from "./saved.ts";

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

/**
 * The saved proposal when there is one and the person takes it; `null` for
 * none, or a "no" (the flow starts as on a first visit), or `--fresh`.
 */
export const savedProposal = async (
  o: OnboardOptions,
  root: string,
  priced: boolean,
  out: (line: string) => void,
): Promise<Step<Proposal> | null> => {
  const saved = o.fresh ? null : findSavedProposal(o.store, root);
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
