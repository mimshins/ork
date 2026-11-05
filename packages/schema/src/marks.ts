/**
 * @file How Ork's messages mark a value: in backticks, which the browser view
 *   shows as inline code. A value that came from outside, such as a condition
 *   or an argument, can hold backticks or line breaks of its own, so it goes
 *   through here to keep the message's marks right.
 */

const RUNS_OF_BACKTICKS = /`+/gu;

/**
 * A value, marked for a message: on one line, in more backticks than it holds,
 * as Markdown does it. Nothing at all can't be marked, so it says so.
 */
export const markValue = (value: string): string => {
  const line = value.replaceAll(/\s+/gu, " ").trim();
  if (line === "") return "(nothing)";
  const longest = Math.max(
    0,
    ...[...line.matchAll(RUNS_OF_BACKTICKS)].map(([run]) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = line.startsWith("`") || line.endsWith("`") ? " " : "";
  return `${fence}${pad}${line}${pad}${fence}`;
};
