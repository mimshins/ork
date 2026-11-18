/**
 * @file The error of an `extract` step: one short line, and whether the call's
 *   own arguments caused it, so the tool's answer marks it as the agent's
 *   mistake rather than a failure of Ork (`tool.result`'s `fault`).
 */

/** A step that failed; the message is one short line. */
export class StepError extends Error {
  /** The call's arguments caused it: a missing file, a name not a commit. */
  byArguments = false;
}

/** A `StepError` that what the call asked for caused. */
export const badStep = (message: string): StepError =>
  Object.assign(new StepError(message), { byArguments: true });

/** Why a `rev:path` revision is refused (L450). */
export const REV_PATH =
  "a commit, not rev:path; extract cannot read a file as it was at a commit";
