/**
 * @file What the Run workflow form means, apart from how it looks: the values
 *   it starts with, why it cannot start yet, what it sends, and the `ork run`
 *   command that does the same. An input left at its default is not sent, so
 *   the command stays as short as one a person would type.
 */

import type { InputDef, WorkflowView } from "@krapht/ork-server/client";

export type DriverChoice = "" | "sdk" | "cli";

export type RunFlags = {
  driver: DriverChoice;
  inPlace: boolean;
  allowDirty: boolean;
};

export const NO_FLAGS: RunFlags = {
  driver: "",
  inPlace: false,
  allowDirty: false,
};

export type InputValues = Record<string, string>;

const defaultOf = ({ default: value, type }: InputDef): string =>
  value === undefined ? (type === "boolean" ? "false" : "") : String(value);

export const initialValues = (inputs: Record<string, InputDef>): InputValues =>
  Object.fromEntries(
    Object.entries(inputs).map(([name, def]) => [name, defaultOf(def)]),
  );

/** Where a project's workflows stand, with what to do when there are none. */
export const workflowsProblem = (
  project: string | null,
  read: { status: "idle" | "loading" | "ready" | "failed"; error?: string },
  count: number,
): string | null => {
  if (project === null) return null;
  if (read.status === "failed") {
    return `Cannot read the workflows of ${project}: ${read.error ?? "unknown error"}`;
  }
  return read.status === "ready" && count === 0
    ? `${project} has no workflows. Add one to its .ork/workflows folder.`
    : null;
};

/** What the workflow field says while nothing is chosen, and why. */
export const workflowPlaceholder = (
  project: string | null,
  reading: boolean,
  count: number,
): string => {
  if (project === null) return "Choose a project first";
  if (reading) return "Reading workflows…";
  return count === 0 ? "No workflows here" : "Type to find a workflow";
};

/** Why the form cannot start, or null when it can. */
export const blockedBy = (
  project: string | null,
  workflow: WorkflowView | null,
  values: InputValues,
): string | null => {
  if (project === null) return "Pick a project.";
  if (workflow === null) return "Pick a workflow.";
  if (workflow.error !== undefined) {
    return `This workflow does not parse: ${workflow.error}`;
  }
  for (const [name, def] of Object.entries(workflow.inputs)) {
    const value = values[name] ?? "";
    if (def.required === true && value === "") return `Fill in ${name}.`;
    if (
      def.type === "number" &&
      value !== "" &&
      !Number.isFinite(Number(value))
    ) {
      return `${name} must be a number.`;
    }
  }
  return null;
};

/** The inputs worth sending: set, and not just their default. */
export const inputsToSend = (
  inputs: Record<string, InputDef>,
  values: InputValues,
): InputValues =>
  Object.fromEntries(
    Object.entries(inputs).flatMap(([name, def]) => {
      const value = values[name] ?? "";
      return value === "" || value === defaultOf(def) ? [] : [[name, value]];
    }),
  );

const SAFE_WORD = /^[\w./:=@%+,-]+$/u;

/** A word as a POSIX shell reads it back unchanged. */
export const quoted = (word: string): string =>
  SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** The CLI twin, to run from the project's root. */
export const commandOf = (
  workflow: WorkflowView,
  values: InputValues,
  flags: RunFlags,
): string =>
  [
    "ork run",
    quoted(workflow.name),
    "--detach",
    ...Object.entries(inputsToSend(workflow.inputs, values)).map(
      ([name, value]) => `--input ${quoted(`${name}=${value}`)}`,
    ),
    ...(flags.driver === "" ? [] : [`--driver ${flags.driver}`]),
    ...(flags.inPlace ? ["--in-place"] : []),
    ...(flags.allowDirty ? ["--allow-dirty"] : []),
  ].join(" ");
