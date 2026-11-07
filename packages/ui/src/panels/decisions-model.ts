/**
 * @file What the Decisions panel says: an option's words, the command that
 *   gives the same answer (with its note), and how a decision that has left the
 *   open list ended.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { quoted } from "./run-form.ts";

export type Choice = DecisionRecord["options"][number];

export const choiceLabel = ({ id, label }: Choice): string => label ?? id;

/**
 * The CLI twin of choosing this option, with the note when there is one; with
 * no option, the place for one.
 */
export const answerCommand = (
  { id, runId }: DecisionRecord,
  choice: Choice | undefined,
  note = "",
): string => {
  const said = note.trim() === "" ? "" : ` --say ${quoted(note.trim())}`;
  return `ork decide ${runId} --id ${id} --choose ${choice?.id ?? "<option>"}${said}`;
};

const BY: Readonly<Record<NonNullable<DecisionRecord["answeredBy"]>, string>> =
  {
    terminal: "in the run's terminal",
    decide: "with `ork decide`",
    ui: "in `ork ui`",
    owner: "by its owner",
  };

/** A sentence on how it ended, with who gave the answer. */
export const endingOf = ({
  status,
  options,
  answer,
  answeredBy,
  owner,
}: DecisionRecord): string => {
  if (status === "withdrawn") return "Withdrawn: it no longer needs an answer.";
  if (status === "open") return "Its run ended before it was answered.";
  const chosen = options.find(({ id }) => id === answer);
  const word = chosen === undefined ? (answer ?? "") : choiceLabel(chosen);
  if (answeredBy === "owner" && owner !== undefined) {
    return `Answered ${word} by \`${owner}\`, its owner.`;
  }
  const passed = owner === undefined ? "" : `, after \`${owner}\` passed it on`;
  return answeredBy === undefined
    ? `Answered ${word}${passed}.`
    : `Answered ${word} ${BY[answeredBy]}${passed}.`;
};

/** What the person said with their answer, for the settled list. */
export const saidOf = ({ note }: DecisionRecord): string | undefined =>
  note === undefined ? undefined : `They said: ${note}`;

/** The option a digit key picks: `1` is the first. */
export const choiceForKey = (
  options: readonly Choice[],
  key: string,
): Choice | undefined =>
  /^[1-9]$/u.test(key) ? options[Number(key) - 1] : undefined;
