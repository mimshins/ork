/**
 * @file What tab completion reads to offer values: the store opened read-only
 *   (never created or migrated; one at another version gives nothing), the
 *   project the folder is in, its workflows and Ork's own, a workflow's nodes,
 *   runs newest first, a run's nodes, and open decisions. Only ids, names and
 *   statuses: never a prompt, an output or a secret.
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

/** The node ids of the workflow `arg` names; none when it can't be read. */
export const workflowNodes = (
  arg: string,
  cwd: string,
  place: ProjectPlace,
): Candidate[] => {
  const text = workflowText(arg, cwd, place);
  const parsed: unknown = text === undefined ? undefined : parse(text);
  const nodes =
    parsed !== null && typeof parsed === "object" && "nodes" in parsed
      ? parsed.nodes
      : undefined;
  const keys =
    nodes !== null && typeof nodes === "object" ? Object.keys(nodes) : [];
  // Only real node ids: a key is the file's text, not a value to type.
  return keys
    .filter(key => NodeIdSchema.safeParse(key).success)
    .map(value => ({ value, description: arg }));
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
