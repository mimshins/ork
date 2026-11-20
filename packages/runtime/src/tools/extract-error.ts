/**
 * @file The error of an `extract` step: one short line, and whether the call's
 *   own arguments caused it, so the tool's answer marks it as the agent's
 *   mistake rather than a failure of Ork (`tool.result`'s `fault`); git's
 *   failures split the same way (`gitError`).
 */

/** A step that failed; the message is one short line. */
export class StepError extends Error {
  /** The call's arguments caused it: a missing file, a name not a commit. */
  byArguments = false;
}

/** A `StepError` that what the call asked for caused. */
export const badStep = (message: string): StepError =>
  Object.assign(new StepError(message), { byArguments: true });

/** How `git grep` refuses a pattern it can't compile: `-e option, '<p>': why`. */
const BAD_PATTERN = /^fatal: (?:-e option|command line), '(.*)': (.*)$/mu;

/**
 * Git's failure with exit `code`: the call's mistake when git could not compile
 * its pattern (exit 128; the reason after the pattern differs by platform),
 * Ork's otherwise.
 */
export const gitError = (code: unknown, stderr: string): StepError => {
  const [, pattern, why = ""] =
    (code === 128 ? BAD_PATTERN.exec(stderr) : null) ?? [];
  if (pattern !== undefined) {
    return badStep(`invalid regular expression: ${pattern} (${why})`);
  }
  const first = stderr.trim().split("\n")[0] ?? "";
  return new StepError(`git failed: ${first || "no message"}`);
};

/** Why a `rev:path` revision is refused (L450). */
export const REV_PATH =
  "a commit, not rev:path; extract cannot read a file as it was at a commit";
