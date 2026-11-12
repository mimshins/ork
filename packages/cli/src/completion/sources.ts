/**
 * @file What tab completion reads to offer values: the store opened read-only
 *   (never created or migrated; one at another version gives nothing), the
 *   project the folder is in, its workflows and Ork's own, a workflow's nodes
 *   and inputs, runs newest first, a run's nodes and its workflow's inputs, and
 *   open decisions. Only ids, names, statuses and inputs' descriptions: never a
 *   prompt, an output or a secret.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  builtinWorkflowNames,
  builtinWorkflowText,
  type EventStore,
  findRun,
  isBuiltinArg,
  liveStatus,
  openStore,
  pendingDecisions,
  placeFiles,
  placeFor,
  type ProjectPlace,
  storePath,
} from "@krapht/ork-core";
import { NodeIdSchema } from "@krapht/ork-schema";
import { parse } from "yaml";

import { resolveWorkflowArg, WORKFLOW_SUFFIX } from "../workflows.ts";

/** One value to offer, and what it is. */
export type Candidate = { value: string; description: string };

/** How many runs completion offers. */
export const RUN_LIMIT = 50;

/** The store at `~/.ork/state.db`, read-only; none when it can't be read. */
export const readOnlyStore = (
  file: string = storePath(),
): EventStore | undefined => {
  if (!existsSync(file)) return undefined;
  try {
    return openStore(file, { readOnly: true });
  } catch {
    return undefined;
  }
};

/** The project `cwd` is in, from the store's registered projects if any. */
export const placeOf = (
  cwd: string,
  store: EventStore | undefined,
): ProjectPlace => placeFor(cwd, store?.projects() ?? []);

/** The project's workflows by name, then Ork's own by their `ork:` name. */
export const workflowCandidates = (place: ProjectPlace): Candidate[] => {
  const folder = placeFiles(place).workflows;
  const names = existsSync(folder)
    ? readdirSync(folder)
        .filter(name => name.endsWith(WORKFLOW_SUFFIX))
        .map(name => name.slice(0, -WORKFLOW_SUFFIX.length))
        .toSorted()
    : [];
  return [
    ...names.map(value => ({ value, description: "this project's workflow" })),
    ...builtinWorkflowNames().map(value => ({
      value,
      description: "one of Ork's workflows",
    })),
  ];
};

/**
 * A workflow argument's text: Ork's own (never written out here), or the file
 * the argument names as every command resolves it; none for a folder.
 */
const workflowText = (
  arg: string,
  cwd: string,
  place: ProjectPlace,
): string | undefined => {
  if (isBuiltinArg(arg)) return builtinWorkflowText(arg);
  const file = path.resolve(
    cwd,
    resolveWorkflowArg(arg, cwd, placeFiles(place).workflows),
  );
  return existsSync(file) && statSync(file).isFile()
    ? readFileSync(file, "utf8")
    : undefined;
};

/** A mapping's entries, or none when `value` is not an object. */
const entriesOf = (value: unknown): [string, unknown][] =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];

/** One top-level field of a workflow's text, read without validating it. */
const fieldOf = (text: string | undefined, field: string): unknown => {
  const parsed: unknown = text === undefined ? undefined : parse(text);
  return Object.fromEntries(entriesOf(parsed))[field];
};

/** The node ids of the workflow `arg` names; none when it can't be read. */
export const workflowNodes = (
  arg: string,
  cwd: string,
  place: ProjectPlace,
): Candidate[] => {
  const keys = entriesOf(fieldOf(workflowText(arg, cwd, place), "nodes")).map(
    ([key]) => key,
  );
  // Only real node ids: a key is the file's text, not a value to type.
  return keys
    .filter(key => NodeIdSchema.safeParse(key).success)
    .map(value => ({ value, description: arg }));
};

/** What a menu says of an input: its description, else its type. */
const inputDescription = (definition: unknown): string => {
  const fields = Object.fromEntries(entriesOf(definition));
  const said = fields["description"] ?? fields["type"];
  const what = typeof said === "string" ? said : "";
  const required = fields["required"] === true && !("default" in fields);
  return required ? `${what} (required)` : what;
};

/**
 * `name=` for each input a workflow's text declares, for `--input`; a name that
 * isn't a valid id is left out, as a node's is.
 */
const inputsOf = (text: string | undefined, workflow: string): Candidate[] =>
  entriesOf(fieldOf(text, "inputs"))
    .filter(([name]) => NodeIdSchema.safeParse(name).success)
    .map(([name, definition]) => ({
      value: `${name}=`,
      description: inputDescription(definition) || workflow,
    }));

/** The inputs of the workflow `arg` names; none when it can't be read. */
export const workflowInputs = (
  arg: string,
  cwd: string,
  place: ProjectPlace,
): Candidate[] => inputsOf(workflowText(arg, cwd, place), arg);

/** The inputs of the run `arg` names (else the project's newest run). */
export const runInputs = (
  store: EventStore,
  arg: string | undefined,
  cwd: string,
): Candidate[] => {
  const found = findRun(store, arg, cwd);
  if (!found.ok) return [];
  const { file, workflow } = found.run;
  const text =
    existsSync(file) && statSync(file).isFile()
      ? readFileSync(file, "utf8")
      : undefined;
  return inputsOf(text, workflow);
};

/**
 * Runs whose id starts with `prefix`, newest first: the project's, else any
 * project's, at most `RUN_LIMIT`.
 */
export const runCandidates = (
  store: EventStore,
  place: ProjectPlace,
  prefix: string,
): Candidate[] => {
  const starts = (id: string): boolean => id.startsWith(prefix);
  const own = store
    .runs({ project: place.root, limit: RUN_LIMIT })
    .filter(run => starts(run.id));
  const fallback =
    prefix === ""
      ? store.runs({ limit: RUN_LIMIT })
      : store.lookup(prefix).slice(0, RUN_LIMIT);
  return (own.length > 0 ? own : fallback).map(run => ({
    value: run.id,
    description: `${run.workflow} · ${liveStatus(run)}`,
  }));
};

/** The run `arg` names, or the project's newest; its nodes in order. */
export const runNodes = (
  store: EventStore,
  arg: string | undefined,
  cwd: string,
): Candidate[] => {
  const found = findRun(store, arg, cwd);
  if (!found.ok) return [];
  const { id } = found.run;
  return store.nodes(id).map(value => ({ value, description: `run ${id}` }));
};

/** Whose decisions: the run `arg` names, else the project's runs. */
const decisionFilter = (
  store: EventStore,
  arg: string | undefined,
  cwd: string,
  place: ProjectPlace,
): { runId: string } | { project: string } | undefined => {
  if (arg === undefined) return { project: place.root };
  const found = findRun(store, arg, cwd);
  return found.ok ? { runId: found.run.id } : undefined;
};

/** The open decisions of the run `arg` names, else of the project's runs. */
export const decisionCandidates = (
  store: EventStore,
  arg: string | undefined,
  cwd: string,
  place: ProjectPlace,
): Candidate[] => {
  const filter = decisionFilter(store, arg, cwd, place);
  return filter === undefined
    ? []
    : pendingDecisions(store, filter).map(decision => ({
        value: decision.id,
        description: `${decision.kind} of ${decision.runId}/${decision.node}`,
      }));
};

/** The registered projects, by id, with their root. */
export const projectCandidates = (store: EventStore): Candidate[] =>
  store.projects().map(p => ({ value: p.id, description: p.root }));

/**
 * Whom a follow-up is for (`--for`): `agent`, `me`, a registered project as
 * `project:<id>`; a person has no list, so `person:` is left to be typed.
 */
export const forCandidates = (store: EventStore | undefined): Candidate[] => [
  { value: "agent", description: "an agent picks it up" },
  { value: "me", description: "you do" },
  ...(store?.projects() ?? []).map(p => ({
    value: `project:${p.id}`,
    description: p.root,
  })),
];
