/**
 * @file `ork run --follow-ups <ids>`: the `agent` follow-ups become the run's
 *   `brief` input, and are marked taken by the run, which finishes them when it
 *   publishes (`ork follow-ups published`). Everything that could refuse them
 *   (an unknown id, one for someone else, a workflow with no `brief` input) is
 *   checked before any is marked, so a run that doesn't start leaves them be.
 */

import {
  availableDue,
  type EventStore,
  type GhRunner,
  newRunId,
  runGh,
  takeFollowUps,
} from "@krapht/ork-core";

import { flagValues } from "../commands/run.ts";
import { loadWorkflow } from "../commands/validate.ts";
import { writeErr } from "../output.ts";
import { briefOf, checkTakeable, refreshDue, runIsLive } from "./context.ts";

/** What `ork run` starts with: its inputs, and the id its run is given. */
export type PreparedRun = { inputs: readonly string[]; runId?: string };

const FLAG = "--follow-ups";

/** What `--follow-ups` takes besides ids: every due agent follow-up. */
const DUE = "due";

/**
 * Each `--follow-ups` value as typed (one per use, still comma-joined), and
 * whether one is missing: no value, an empty one, or a next argument that is
 * another flag.
 */
const given = (
  rawArgs: readonly string[],
): { values: string[]; empty: boolean } => {
  const values: string[] = [];
  let empty = false;
  for (const [index, arg] of rawArgs.entries()) {
    if (arg !== FLAG && !arg.startsWith(`${FLAG}=`)) continue;
    const next = rawArgs[index + 1];
    const value =
      arg === FLAG
        ? next === undefined || next.startsWith("--")
          ? ""
          : next
        : arg.slice(FLAG.length + 1);
    const parts = value
      .split(",")
      .map(part => part.trim())
      .filter(part => part !== "");
    if (parts.length === 0) empty = true;
    values.push(...parts);
  }
  return { values, empty };
};

/**
 * Says what `--follow-ups` needs when it is given with nothing after it, and
 * fails the command; true when it is fine (or not given).
 */
export const followUpsFlagFine = (rawArgs: readonly string[]): boolean => {
  if (!given(rawArgs).empty) return true;
  writeErr(
    `${FLAG} needs follow-up ids, or \`${DUE}\` for every due agent follow-up. \`ork follow-ups list\` shows them.`,
  );
  process.exitCode = 1;
  return false;
};

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
 * takes them. `undefined` after saying why it can't start. With `mark` false
 * nothing is marked taken: a `--detach` parent checks before it makes the run
 * folder, and the run it starts marks them.
 */
export const prepareFollowUps = async (
  store: EventStore,
  rawArgs: readonly string[],
  runId: string | undefined,
  target: { file: string },
  gh: GhRunner = runGh,
  mark = true,
): Promise<PreparedRun | undefined> => {
  const inputs = flagValues(rawArgs, "--input");
  const plain: PreparedRun = {
    inputs,
    ...(runId === undefined ? {} : { runId }),
  };
  if (!followUpsFlagFine(rawArgs)) return undefined;
  const { values } = given(rawArgs);
  if (values.length === 0) return plain;
  const loaded = loadWorkflow(
    target.file,
    process.cwd(),
    undefined,
    store.projects(),
  );
  // A workflow that doesn't load is reported by the run itself.
  if (loaded.workflow === null) return plain;
  const project = loaded.place.root;
  const named = values.filter(value => value !== DUE);
  // `refreshDue` answers only those that just came due; every due one counts.
  if (values.includes(DUE)) await refreshDue(store, project, writeErr, gh);
  const isLive = runIsLive(store);
  const { ids: due, held } = values.includes(DUE)
    ? availableDue(store, project, isLive, runId)
    : { ids: [], held: [] };
  // Two `--follow-ups due` runs at once: the second leaves what the first took.
  for (const f of held) {
    writeErr(
      `${FLAG} ${DUE}: skipped ${f.id}, taken by run ${f.takenBy}, still running.`,
    );
  }
  if (named.length === 0 && due.length === 0) {
    const reason =
      held.length > 0
        ? ` ${held.length} due ${held.length === 1 ? "one is" : "ones are"} taken by a run still running.`
        : "";
    writeErr(
      `${FLAG} ${DUE}: no agent follow-ups are due.${reason} \`ork follow-ups list\` shows them.`,
    );
    process.exitCode = 1;
    return undefined;
  }
  const takeable = checkTakeable(store, project, [...named, ...due]);
  const problems = [
    ...problemsOf(loaded, inputs),
    ...(takeable.ok ? [] : takeable.lines),
  ];
  if (!takeable.ok || problems.length > 0) {
    for (const line of problems) writeErr(line);
    process.exitCode = 1;
    return undefined;
  }
  // An id given and also due (or by prefix and in full) is taken once.
  const followUps = [
    ...new Map(takeable.followUps.map(f => [f.id, f])).values(),
  ];
  if (!mark) return plain;
  const taker = runId ?? newRunId(store);
  takeFollowUps(store, {
    project,
    run: taker,
    ids: followUps.map(f => f.id),
    isLive,
  });
  return {
    inputs: [...inputs, `brief=${briefOf(followUps)}`],
    runId: taker,
  };
};
