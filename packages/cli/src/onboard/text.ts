/**
 * @file Text the onboarding survey and history take from a repository, a store
 *   or a model: it is data for a prompt, so it is one line, free of control
 *   characters, and cut to a length (`ork onboard`, specs/cli/onboard.md).
 */

/** `text` as one line: whitespace collapsed, control characters dropped. */
export const oneLine = (text: string, max = 120): string => {
  // oxlint-disable-next-line no-control-regex -- the point is to drop them
  const clean = text.replaceAll(/[\u0000-\u001F\u007F-\u009F]+/gu, " ");
  const line = clean.replaceAll(/\s+/gu, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** The first `max` of `items`, and a line saying how many were left out. */
export const capped = <T>(
  items: readonly T[],
  max: number,
): { shown: T[]; more: number } => ({
  shown: items.slice(0, max),
  more: Math.max(0, items.length - max),
});
