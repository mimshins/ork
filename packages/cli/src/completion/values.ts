/**
 * @file The values tab completion offers for an argument, one provider per
 *   argument name (a positional `run`, a flag `--node`), so a new command whose
 *   argument has one of these names gets its values with no change here. A
 *   provider for one command only is keyed by the command's path and the name
 *   (`decide id`). Each provider names the group its values are shown under.
 */

import type { EventStore } from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";

import { SHELLS } from "./scripts.ts";
import {
  type Candidate,
  decisionCandidates,
  placeOf,
  runCandidates,
  runInputs,
  runNodes,
  workflowCandidates,
  workflowInputs,
  workflowNodes,
} from "./sources.ts";

/** What a provider knows: the folder, what was typed, and the store. */
export type ValueContext = {
  cwd: string;
  /** Positionals and flag values given before the cursor, by name. */
  given: Readonly<Record<string, string>>;
  /** The word under the cursor, as typed so far. */
  current: string;
  /** The command's positionals' names. */
  positionals: readonly string[];
  /** The store, read-only, opened on first use; none when it can't be read. */
  store: () => EventStore | undefined;
};

/** Values for one argument; `files` also asks the shell for file names. */
export type ValueProvider = {
  group: string;
  values: (context: ValueContext) => Candidate[];
  files?: boolean;
};

const withStore = (
  context: ValueContext,
  read: (store: EventStore) => Candidate[],
): Candidate[] => {
  const store = context.store();
  return store === undefined ? [] : read(store);
};

const runs: ValueProvider = {
  group: "runs",
  values: context =>
    withStore(context, store =>
      runCandidates(store, placeOf(context.cwd, store), context.current),
    ),
};

const workflows: ValueProvider = {
  group: "workflows",
  values: context => workflowCandidates(placeOf(context.cwd, context.store())),
};

/** A workflow's nodes when the command takes a workflow, else a run's. */
const nodes: ValueProvider = {
  group: "nodes",
  values: context => {
    const workflow = context.given["workflow"];
    if (context.positionals.includes("workflow")) {
      return workflow === undefined
        ? []
        : workflowNodes(
            workflow,
            context.cwd,
            placeOf(context.cwd, context.store()),
          );
    }
    return withStore(context, store =>
      runNodes(store, context.given["run"], context.cwd),
    );
  },
};

/**
 * `name=` for each input, for `--input`: the workflow given's when the command
 * takes a workflow (none before it is), else the run given's (`ork resume`).
 */
const inputs: ValueProvider = {
  group: "inputs",
  values: context => {
    const workflow = context.given["workflow"];
    if (context.positionals.includes("workflow")) {
      return workflow === undefined
        ? []
        : workflowInputs(
            workflow,
            context.cwd,
            placeOf(context.cwd, context.store()),
          );
    }
    return withStore(context, store =>
      runInputs(store, context.given["run"], context.cwd),
    );
  },
};

const decisions: ValueProvider = {
  group: "decisions",
  values: context =>
    withStore(context, store =>
      decisionCandidates(
        store,
        context.given["run"],
        context.cwd,
        placeOf(context.cwd, store),
      ),
    ),
};

const drivers: ValueProvider = {
  group: "drivers",
  values: () =>
    AGENT_DRIVERS.map(driver => ({
      value: driver.id,
      description: driver.label,
    })),
};

const files: ValueProvider = { group: "files", values: () => [], files: true };

const shells: ValueProvider = {
  group: "shells",
  values: () => SHELLS.map(value => ({ value, description: "" })),
};

/** Providers by argument name, or by command path and name. */
export const VALUE_PROVIDERS: Readonly<Record<string, ValueProvider>> = {
  run: runs,
  workflow: workflows,
  files: { ...workflows, files: true },
  node: nodes,
  input: inputs,
  "decide id": decisions,
  "completion shell": shells,
  driver: drivers,
  path: files,
  file: files,
  output: files,
};

/** The provider for argument `name` of the command at `path`, if any. */
export const providerFor = (
  providers: Readonly<Record<string, ValueProvider>>,
  path: readonly string[],
  name: string,
): ValueProvider | undefined =>
  providers[[...path, name].join(" ")] ?? providers[name];
