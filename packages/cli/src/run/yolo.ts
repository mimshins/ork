/**
 * @file `--yolo` on `ork run` and `ork resume` (specs/cli/running-and-runs.md):
 *   the warning, then a y/N on the terminal, No by default. With `--yes` it is
 *   agreed to without the question; with no terminal only `--yes` agrees, as
 *   nobody is there to answer. A detached start asks before it detaches, and
 *   hands its copy `--yes`, as a yolo run does to the runs it calls.
 */

import { confirm, style, writeErr } from "../output.ts";

export const YOLO_WARNING = [
  "Yolo: every tool call this run's agents make runs without asking you,",
  "except what a node's deny list refuses. Agents can edit, delete and run",
  "anything your user can. Questions, gates and budgets still stop the run.",
].join("\n");

export const YOLO_NEEDS_YES =
  "--yolo needs a yes: run it on a terminal, or add --yes.";

export type YoloAsk = {
  /** `--yes` was given. */
  yes: boolean;
  /** Stdin and stderr are a terminal, so someone can answer. */
  terminal: boolean;
  /** Asks the y/N; the real one by default (tests pass their own). */
  ask?: (question: string) => Promise<boolean>;
};

/**
 * Whether the run may start yolo: prints the warning, then takes `--yes` or the
 * person's answer. False means nothing starts; the caller exits 1.
 */
export const agreedToYolo = async (o: YoloAsk): Promise<boolean> => {
  if (!o.yes && !o.terminal) {
    writeErr(YOLO_NEEDS_YES);
    return false;
  }
  writeErr(style("yellow", YOLO_WARNING));
  if (o.yes) return true;
  const yes = await (o.ask ?? confirm)("Run with no permission prompts?");
  if (!yes) writeErr("Not started.");
  return yes;
};

/** `rawArgs` for a detached copy of an agreed yolo start: with `--yes`. */
export const withYes = (rawArgs: readonly string[]): string[] =>
  rawArgs.includes("--yes") || rawArgs.includes("-y")
    ? [...rawArgs]
    : [...rawArgs, "--yes"];
