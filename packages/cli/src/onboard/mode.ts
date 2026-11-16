/**
 * @file Which visit `ork onboard` is on: a first visit, or a review of what the
 *   project's workflows and runs showed (specs/cli/onboard-flow.md#mode). What
 *   the project holds decides it; `--review` and `--fresh` override.
 */

export type OnboardMode = "first" | "review";

/** The starter `ork init` writes; it alone is not something to review. */
const STARTER_NAME = "hello";

/**
 * The mode: review when the project holds a workflow other than the starter and
 * a run of its own, unless a flag says otherwise.
 */
export const modeOf = (
  held: { workflows: readonly string[]; runs: number },
  flags: { review: boolean; fresh: boolean },
): OnboardMode => {
  if (flags.review) return "review";
  if (flags.fresh) return "first";
  const own = held.workflows.filter(name => name !== STARTER_NAME);
  return own.length > 0 && held.runs > 0 ? "review" : "first";
};

/** The line printed before any spend. */
export const modeLine = (
  mode: OnboardMode,
  held: { workflows: readonly string[]; runs: number },
): string =>
  mode === "first"
    ? "Mode: first visit"
    : `Mode: review (${String(held.workflows.length)} workflows, ${String(held.runs)} runs)`;
