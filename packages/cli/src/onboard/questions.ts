/**
 * @file The three fixed questions of `ork onboard`, asked with the line prompt,
 *   and the `answers` input they make
 *   (specs/cli/onboard-flow.md#the-questions). Each answer is one line, free of
 *   control characters, cut to 2,000 characters; an empty one is kept as `(no
 *   answer)`.
 */

import type { PromptIO } from "../term/mode.ts";
import { readText } from "../term/text.ts";
import type { OnboardMode } from "./mode.ts";
import { oneLine } from "./text.ts";

const MAX_ANSWER = 2000;

export const questionsFor = (mode: OnboardMode): string[] => [
  mode === "first"
    ? "What slows you down most in this project?"
    : "What went wrong lately with Ork's runs here?",
  "What do you ship from this project, and how often?",
  "How is a change reviewed before it lands?",
];

/** The `answers` input: `Q:` and `A:` lines, one blank line between pairs. */
export const answersText = (
  pairs: readonly { question: string; answer: string }[],
): string =>
  pairs
    .map(
      ({ question, answer }) =>
        `Q: ${question}\nA: ${oneLine(answer, MAX_ANSWER) || "(no answer)"}`,
    )
    .join("\n\n");

/** The answers, or `null` when the person pressed Ctrl-C. */
export const askQuestions = async (
  io: PromptIO,
  mode: OnboardMode,
): Promise<string | null> => {
  const pairs: { question: string; answer: string }[] = [];
  for (const question of questionsFor(mode)) {
    // oxlint-disable-next-line no-await-in-loop -- one question at a time
    const result = await readText(io, { message: question });
    if (result.kind === "interrupted") return null;
    pairs.push({
      question,
      answer: result.kind === "text" ? result.value : "",
    });
  }
  return answersText(pairs);
};
