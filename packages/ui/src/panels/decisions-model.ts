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

/** What the Decisions panel is narrowed to; a missing key is All. */
export type DecisionFilter = {
  workflow?: string | undefined;
  run?: string | undefined;
};

/** Everything the filter bar and the cards need of the open list. */
export type FilterView = {
  workflows: { value: string; label: string }[];
  runs: { value: string; label: string }[];
  /** What the filter leaves, in the list's order. */
  shown: DecisionRecord[];
  /** The filter as it stands. */
  active: DecisionFilter;
};

/** The runs' workflows by run id, for the decisions' own runs. */
export type WorkflowOf = (run: string) => string | undefined;

/**
 * The select value for All: no workflow or run name starts with a space, so it
 * never collides with one (a workflow may be named `all`).
 */
export const ALL_VALUE = " all";

const ALL = { value: ALL_VALUE, label: "" };

const counted = (
  decisions: readonly DecisionRecord[],
  keyOf: (decision: DecisionRecord) => string | undefined,
  labelOf: (key: string, count: number) => string,
  /** Workflows by name; runs by their oldest open decision (list order). */
  byName: boolean,
): { value: string; label: string }[] => {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    const key = keyOf(decision);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts];
  return (
    byName ? entries.toSorted(([a], [b]) => a.localeCompare(b)) : entries
  ).map(([key, count]) => ({ value: key, label: labelOf(key, count) }));
};

/** The filter without a value no decision has now (`filterView` keeps it). */
export const presentOnly = (
  open: readonly DecisionRecord[],
  { workflow, run }: DecisionFilter,
  workflowOf: WorkflowOf,
): DecisionFilter => ({
  ...(open.some(({ runId }) => workflowOf(runId) === workflow) &&
  workflow !== undefined
    ? { workflow }
    : {}),
  ...(open.some(({ runId }) => runId === run) && run !== undefined
    ? { run }
    : {}),
});

/** A chosen value that nothing has now stays listed, so the select shows it. */
const withChosen = (
  options: { value: string; label: string }[],
  chosen: string | undefined,
): { value: string; label: string }[] =>
  chosen === undefined || options.some(({ value }) => value === chosen)
    ? options
    : [...options, { value: chosen, label: `${chosen} (0)` }];

/**
 * The bar's options (each present value with its count of open decisions; the
 * runs only those of the chosen workflow), and the cards the filter leaves.
 */
export const filterView = (
  open: readonly DecisionRecord[],
  { workflow, run }: DecisionFilter,
  workflowOf: WorkflowOf,
): FilterView => {
  const ofWorkflow = open.filter(
    ({ runId }) => workflow === undefined || workflowOf(runId) === workflow,
  );
  return {
    workflows: [
      { ...ALL, label: `All (${open.length})` },
      ...withChosen(
        counted(
          open,
          ({ runId }) => workflowOf(runId),
          (key, count) => `${key} (${count})`,
          true,
        ),
        workflow,
      ),
    ],
    runs: [
      { ...ALL, label: `All (${ofWorkflow.length})` },
      ...withChosen(
        counted(
          ofWorkflow,
          ({ runId }) => runId,
          (key, count) => {
            const of = workflowOf(key);
            return `${key}${of === undefined ? "" : ` · ${of}`} (${count})`;
          },
          false,
        ),
        run,
      ),
    ],
    shown: ofWorkflow.filter(({ runId }) => run === undefined || runId === run),
    active: {
      ...(workflow === undefined ? {} : { workflow }),
      ...(run === undefined ? {} : { run }),
    },
  };
};

/** The count line: how many show, and how many the filter hides. */
export const countLine = (open: number, shown: number): string => {
  if (shown === open) {
    return open === 1 ? "1 open decision." : `${open} open decisions.`;
  }
  return `${shown} of ${open} open decisions shown; ${open - shown} hidden by the filter.`;
};

/** Whether a filter narrows anything. */
export const isFiltered = ({ workflow, run }: DecisionFilter): boolean =>
  workflow !== undefined || run !== undefined;

/** The `ork decide --list` that shows what a filter shows. */
export const listCommand = ({ workflow, run }: DecisionFilter): string =>
  run === undefined
    ? `ork decide --list${workflow === undefined ? "" : ` --workflow ${workflow}`}`
    : `ork decide ${run} --list`;
