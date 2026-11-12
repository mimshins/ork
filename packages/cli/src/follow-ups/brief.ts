/**
 * @file `ork run --follow-ups <ids>`: the `agent` follow-ups become the run's
 *   `brief` input, and are marked taken by the run, which finishes them when it
 *   publishes (`ork follow-ups published`). Everything that could refuse them
 *   (an unknown id, one for someone else, a workflow with no `brief` input) is
 *   checked before any is marked, so a run that doesn't start leaves them be.
 */

import { type EventStore, newRunId, takeFollowUps } from "@krapht/ork-core";

import { flagValues } from "../commands/run.ts";
import { loadWorkflow } from "../commands/validate.ts";
import { writeErr } from "../output.ts";
import { briefOf, checkTakeable } from "./context.ts";

/** What `ork run` starts with: its inputs, and the id its run is given. */
export type PreparedRun = { inputs: readonly string[]; runId?: string };

/** The ids `--follow-ups` was given, one per comma or repeat. */
const idsOf = (rawArgs: readonly string[]): string[] =>
  flagValues(rawArgs, "--follow-ups")
    .flatMap(value => value.split(","))
    .map(id => id.trim())
    .filter(id => id !== "");

/**
 * What stops `--follow-ups` from starting a run, one line each; none when
 * nothing does.
 */
const problemsOf = (
  loaded: Pick<ReturnType<typeof loadWorkflow>, "workflow">,
  inputs: readonly string[],
): string[] => {
  const name = loaded.workflow?.name ?? "";
  if (loaded.workflow?.inputs?.["brief"] === undefined) {
    return [
      `--follow-ups fills a workflow's \`brief\` input, and ${name} has none.`,
    ];
  }
  return inputs.some(input => input.startsWith("brief="))
    ? ["--follow-ups and --input brief=… both set the brief."]
    : [];
};

/**
 * The inputs and run id `ork run` starts with: those it was given and, for
 * `--follow-ups`, a `brief` made of the follow-ups with the id of the run that
 * takes them. `undefined` after saying why it can't start.
 */
export const prepareFollowUps = (
  store: EventStore,
  rawArgs: readonly string[],
  runId: string | undefined,
  target: { file: string },
): PreparedRun | undefined => {
  const inputs = flagValues(rawArgs, "--input");
  const ids = idsOf(rawArgs);
  const plain: PreparedRun = {
    inputs,
    ...(runId === undefined ? {} : { runId }),
  };
  if (ids.length === 0) return plain;
  const loaded = loadWorkflow(
    target.file,
    process.cwd(),
    undefined,
    store.projects(),
  );
  // A workflow that doesn't load is reported by the run itself.
  if (loaded.workflow === null) return plain;
  const takeable = checkTakeable(store, loaded.place.root, ids);
  const problems = [
    ...problemsOf(loaded, inputs),
    ...(takeable.ok ? [] : takeable.lines),
  ];
  if (!takeable.ok || problems.length > 0) {
    for (const line of problems) writeErr(line);
    process.exitCode = 1;
    return undefined;
  }
  const taker = runId ?? newRunId(store);
  takeFollowUps(store, {
    project: loaded.place.root,
    run: taker,
    ids: takeable.followUps.map(f => f.id),
  });
  return {
    inputs: [...inputs, `brief=${briefOf(takeable.followUps)}`],
    runId: taker,
  };
};
