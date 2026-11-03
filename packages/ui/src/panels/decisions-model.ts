/**
 * @file What the Decisions panel says: an option's words, the command that
 *   gives the same answer, and how a decision that has left the open list
 *   ended.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

export type Choice = DecisionRecord["options"][number];

export const choiceLabel = ({ id, label }: Choice): string => label ?? id;

/** The CLI twin of choosing this option. */
export const answerCommand = (
  { id, runId }: DecisionRecord,
  choice: Choice,
): string => `ork decide ${runId} --id ${id} --choose ${choice.id}`;

const BY: Readonly<Record<NonNullable<DecisionRecord["answeredBy"]>, string>> =
  {
    terminal: "in the run's terminal",
    decide: "with ork decide",
    ui: "in ork ui",
  };

/** A sentence on how it ended, with who gave the answer. */
export const endingOf = ({
  status,
  options,
  answer,
  answeredBy,
}: DecisionRecord): string => {
  if (status === "withdrawn") return "Withdrawn: it no longer needs an answer.";
  if (status === "open") return "Its run ended before it was answered.";
  const chosen = options.find(({ id }) => id === answer);
  const word = chosen === undefined ? (answer ?? "") : choiceLabel(chosen);
  return answeredBy === undefined
    ? `Answered ${word}.`
    : `Answered ${word} ${BY[answeredBy]}.`;
};

/** The option a digit key picks: `1` is the first. */
export const choiceForKey = (
  options: readonly Choice[],
  key: string,
): Choice | undefined =>
  /^[1-9]$/u.test(key) ? options[Number(key) - 1] : undefined;
