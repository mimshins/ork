/**
 * @file `ork onboard`'s steps in order (specs/cli/onboard-flow.md): the free
 *   steps in `setup.ts`, then the questions, the cost preview and the two
 *   built-in runs with the picks between them; or, when a proposal was left at
 *   the pick, the offer to start from it. A "no" or no pick ends with exit 0
 *   and nothing written. It returns the exit code and prints through `out` and
 *   `err`.
 */

import { AGENT_DRIVERS } from "@krapht/ork-integrations";

import { style } from "../output.ts";
import { confirmOrStop } from "../term/confirm.ts";
import { capsOfOnboard, previewLine } from "./caps.ts";
import type { OnboardOptions } from "./options.ts";
import { pickSuggestions, proposedOf } from "./pick.ts";
import { askQuestions } from "./questions.ts";
import {
  failedLines,
  interruptedLines,
  type RunOptions,
  runPropose,
  runWrite,
  settleWrite,
  spentLine,
} from "./runs.ts";
import {
  INTERRUPTED,
  type Proposal,
  savedProposal,
  type Step,
  stopWith,
} from "./saved-offer.ts";
import { initNote, type Prepared, prepare } from "./setup.ts";

type Ready = Extract<Prepared, { kind: "ready" }>;

/** The questions, the preview and the paid propose run. */
const newProposal = async (
  o: OnboardOptions,
  ready: Ready,
  run: RunOptions,
  priced: boolean,
  out: (line: string) => void,
): Promise<Step<Proposal>> => {
  const answers = await askQuestions(o.io, ready.mode);
  if (answers === null) return stopWith([], INTERRUPTED);
  out(previewLine(capsOfOnboard(), priced));
  const go = await confirmOrStop(o.io, { question: "Start?" });
  if (go === null) return stopWith([], INTERRUPTED);
  if (!go) return stopWith(["Nothing started, nothing written."], 0);

  out(style("bold", "▸ proposing workflows"));
  const { survey, history } = ready;
  const proposed = await runPropose(run, { survey, answers, history });
  if (!proposed.ok) return stopWith(proposed.lines, 1);
  const { result } = proposed;
  if (result.status !== "succeeded") {
    return stopWith(failedLines("the proposing run", result), 1);
  }
  return {
    survey,
    answers,
    proposed: proposedOf(result, ready.place.root),
    run: { id: result.runId, spent: spentLine(result) },
  };
};

/** Runs the command; the exit code. */
export const runOnboard = async (o: OnboardOptions): Promise<number> => {
  const { out, err } = o;
  const stop = (lines: readonly string[], code: number): number => {
    for (const line of lines) (code === 0 ? out : err)(line);
    return code;
  };
  const ready = await prepare(o);
  if (ready.kind === "stop") return stop(ready.lines, ready.code);
  const run: RunOptions = { ...o, place: ready.place, driver: ready.driver };
  const priced =
    AGENT_DRIVERS.find(d => d.id === ready.driver)?.capabilities.price ?? true;

  const step =
    (await savedProposal(o, ready.place.root, priced, out)) ??
    (await newProposal(o, ready, run, priced, out));
  if ("stop" in step) return stop(step.stop.lines, step.stop.code);
  const { survey, answers, proposed: suggestions } = step;

  const picks = await pickSuggestions(o.io, suggestions, out);
  if (picks === null) return stop(interruptedLines(step.run), INTERRUPTED);
  if (picks.length === 0) {
    return stop(
      [
        suggestions.kept.length === 0
          ? "Nothing to write: no suggestion survived the checks."
          : "Nothing picked; nothing written.",
      ],
      0,
    );
  }

  out(style("bold", `▸ writing ${String(picks.length)} workflow(s)`));
  const written = await runWrite(run, {
    picks,
    survey,
    answers,
    note: initNote(ready.fromInit),
  });
  if (!written.ok) return stop(written.lines, 1);
  const cited = [...new Set(picks.flatMap(pick => pick.feedback ?? []))];
  const settled = await settleWrite(
    run,
    written.result,
    cited,
    ready.gitignored,
  );
  const say = settled.code === 0 ? out : err;
  const mark = settled.code === 0 ? style("green", "✓") : style("red", "✗");
  const [first = "", ...rest] = settled.lines;
  say(`${mark} ${first}`);
  for (const line of rest) say(`  ${line}`);
  return settled.code;
};
