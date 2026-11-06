/**
 * @file The cap on a workflow's lessons (ADR-059): a session loads at most
 *   1,500 tokens of `.ork/lessons/<workflow>.md`. Accepting a lesson that would
 *   pass it is refused; a file someone made longer by hand is cut at the cap,
 *   on a line's end, and what loads says how long the whole file was.
 */

/** A rough count, for comparing sizes: about four characters a token. */
export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

/** The most a workflow's lessons add to each of its sessions, in tokens. */
export const LESSON_CAP_TOKENS = 1500;

const CAP_CHARS = LESSON_CAP_TOKENS * 4;

export type CappedLessons = {
  text: string;
  /** The whole file's tokens, when it was cut. */
  cutFrom?: number;
};

/** A lessons file's text as a session loads it: all of it, or cut at the cap. */
export const capLessons = (text: string): CappedLessons => {
  if (estimateTokens(text) <= LESSON_CAP_TOKENS) return { text };
  const lineEnd = text.lastIndexOf("\n", CAP_CHARS - 1);
  const end = lineEnd > 0 ? lineEnd + 1 : CAP_CHARS;
  return { text: text.slice(0, end), cutFrom: estimateTokens(text) };
};
