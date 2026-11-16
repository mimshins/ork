/**
 * @file What `ork onboard` shows before it asks anything: the survey of the
 *   repository, on a review the digest of past runs, and the mode
 *   (specs/cli/onboard-flow.md#the-survey). All of it is read with no model.
 */

import type { EventStore } from "@krapht/ork-core";

import { style } from "../output.ts";
import { historyText, readHistory } from "./history.ts";
import { type OnboardMode, modeLine, modeOf } from "./mode.ts";
import { readSurvey, surveyText } from "./survey.ts";

export type Overview = {
  mode: OnboardMode;
  /** The `survey` input. */
  survey: string;
  /** The `history` input; empty on a first visit. */
  history: string;
};

const dimmed = (out: (line: string) => void, text: string): void => {
  for (const line of text.split("\n")) out(style("dim", `  ${line}`));
};

/** Reads and prints the survey, the digest (review only) and the mode. */
export const overview = async (
  store: EventStore,
  root: string,
  flags: { review: boolean; fresh: boolean },
  out: (line: string) => void,
): Promise<Overview> => {
  const surveyed = await readSurvey(root);
  const past = readHistory(store, root);
  const held = { workflows: surveyed.ork.workflows, runs: past.runs };
  const mode = modeOf(held, flags);
  const survey = surveyText(surveyed);
  out(style("bold", "What Ork read of this project:"));
  dimmed(out, survey);
  const history = mode === "review" ? historyText(past) : "";
  if (history !== "") {
    out(style("bold", "What its runs showed:"));
    dimmed(out, history);
  }
  out(modeLine(mode, held));
  return { mode, survey, history };
};
