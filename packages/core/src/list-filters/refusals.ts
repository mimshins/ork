/**
 * @file The sentences a list refuses with, shared so `ork` and `ork mcp` say
 *   the same words (the server cannot import the CLI).
 */

/** The refusal for a `--limit` that is not a positive whole number in digits. */
export const limitRefusal = (text: string): string =>
  `--limit takes a positive whole number written in digits, not \`${text}\`.`;

/** The refusal for a `--project` that names no registered project. */
export const unknownProjectRefusal = (
  key: string,
  ids: readonly string[],
): string =>
  `No registered project \`${key}\`; registered: ${ids.length === 0 ? "none" : ids.join(", ")}.`;
