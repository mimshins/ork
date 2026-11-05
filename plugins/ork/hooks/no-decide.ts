/**
 * @file A Claude Code hook (RFC-012): it stops Claude Code answering an Ork
 *   decision through its shell with `ork decide`, as a decision is the
 *   person's. Listing what's open (`--list`) goes ahead. It stops accidents; it
 *   is not a boundary. Node runs it as it is, as Ork needs Node 24.
 */

/** `ork decide`, however `ork` is reached, unless it only lists. */
const ANSWERS =
  /(?:^|[\s;&|()`$/])ork(?:@\S*)?\s+decide\b(?![^;&|\n]*(?:--list|\s-l\b))/u;

export const answersADecision = (command: string): boolean =>
  ANSWERS.test(command);

const REASON =
  "A decision in an Ork run is the person's to answer: tell them what it asks and its options, and that they answer in `ork ui` or with `ork decide` in their own terminal. `ork decide --list` shows what's open.";

/** The shell command in a hook's input, or `""`. */
export const commandIn = (input: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return "";
  }
  const toolInput =
    typeof parsed === "object" && parsed !== null && "tool_input" in parsed
      ? parsed.tool_input
      : undefined;
  const command =
    typeof toolInput === "object" &&
    toolInput !== null &&
    "command" in toolInput
      ? toolInput.command
      : undefined;
  return typeof command === "string" ? command : "";
};

if (import.meta.main) {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    chunks.push(chunk);
  });
  process.stdin.on("end", () => {
    if (answersADecision(commandIn(chunks.join("")))) {
      process.stderr.write(REASON);
      process.exitCode = 2;
    }
  });
}
