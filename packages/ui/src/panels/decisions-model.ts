/**
 * @file What the Decisions panel says: an option's words, the command that
 *   gives the same answer (with its note), and how a decision that has left the
 *   open list ended.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import type { Suggestion } from "../components/filter-input.tsx";
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

/**
 * How a decision's code blocks name their copy buttons: "Copy code" with one,
 * "Copy code block 2 of 3" with more, then where they are, so two cards (and
 * the dialog over them) never share a name.
 */
export const codeLabeler =
  (where: string) =>
  (index: number, total: number): string =>
    `${total === 1 ? "Copy code" : `Copy code block ${index} of ${total}`} (${where})`;

/** The CLI twin of reading a decision's document. */
export const documentCommand = ({ runId, id }: DecisionRecord): string =>
  `ork decide ${runId} --id ${id} --document`;

/** A permission's context that is JSON, not a command or path as written. */
export const isJsonContext = (context: string): boolean =>
  context.startsWith("{\n");

/** The runs' workflows by run id, for the decisions' own runs. */
export type WorkflowOf = (run: string) => string | undefined;

/**
 * What the filter bar suggests: each workflow, and each run with its workflow
 * (`4f2a1c · feature`), among the open decisions. Help only; any text applies.
 */
export const suggestionsOf = (
  open: readonly DecisionRecord[],
  workflowOf: WorkflowOf,
): { workflow: Suggestion[]; run: Suggestion[] } => {
  const runs = [...new Set(open.map(({ runId }) => runId))];
  const workflows = [
    ...new Set(runs.flatMap(run => workflowOf(run) ?? [])),
  ].toSorted((a, b) => a.localeCompare(b));
  return {
    workflow: workflows.map(value => ({ value, label: value })),
    run: runs.map(value => {
      const workflow = workflowOf(value);
      return {
        value,
        label: workflow === undefined ? value : `${value} · ${workflow}`,
      };
    }),
  };
};

/** The bar's status line while no filter is set. */
export const openLine = (open: number): string =>
  open === 1 ? "1 open decision." : `${open} open decisions.`;
