/**
 * @file `ork onboard`'s steps in order (specs/cli/onboard-flow.md): the free
 *   steps in `setup.ts`, then the questions, the cost preview and the two
 *   built-in runs with the picks between them. A "no" or no pick ends with exit
 *   0 and nothing written. It returns the exit code and prints through `out`
 *   and `err`.
 */

import { style } from "../output.ts";
import { confirmOrStop } from "../term/confirm.ts";
import { capsOfOnboard, previewLine } from "./caps.ts";
import type { OnboardOptions } from "./options.ts";
import { pickSuggestions, proposedOf } from "./pick.ts";
import { askQuestions } from "./questions.ts";
import {
  failedLines,
  type RunOptions,
  runPropose,
  runWrite,
  settleWrite,
} from "./runs.ts";
import { prepare } from "./setup.ts";

/** The exit code for a person's Ctrl-C. */
const INTERRUPTED = 130;

/** Runs the command; the exit code. */
export const runOnboard = async (o: OnboardOptions): Promise<number> => {
  const { out, err } = o;
  const stop = (lines: readonly string[], code: number): number => {
    for (const line of lines) (code === 0 ? out : err)(line);
    return code;
  };
  const ready = await prepare(o);
  if (ready.kind === "stop") return stop(ready.lines, ready.code);
  const { survey, history } = ready;
  const run: RunOptions = { ...o, place: ready.place, driver: ready.driver };

  const answers = await askQuestions(o.io, ready.mode);
  if (answers === null) return INTERRUPTED;

  out(previewLine(capsOfOnboard()));
  const go = await confirmOrStop(o.io, { question: "Start?" });
  if (go === null) return INTERRUPTED;
  if (!go) return stop(["Nothing started, nothing written."], 0);

  out(style("bold", "▸ proposing workflows"));
  const proposed = await runPropose(run, { survey, answers, history });
  if (!proposed.ok) return stop(proposed.lines, 1);
  if (proposed.result.status !== "succeeded") {
    return stop(failedLines("the proposing run", proposed.result), 1);
  }
  const suggestions = proposedOf(proposed.result, ready.place.root);
  const picks = await pickSuggestions(o.io, suggestions, out);
  if (picks === null) return INTERRUPTED;
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
  const written = await runWrite(run, { picks, survey, answers });
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
