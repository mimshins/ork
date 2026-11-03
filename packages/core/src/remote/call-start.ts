/**
 * @file Starting a called workflow's run (RFC-004): finding its project and
 *   file, refusing what may not be called, and starting it in the background.
 *   Also what a resumed caller attaches to again, and bringing back a run that
 *   a stop ended.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { placeFiles, type ProjectPlace, runDirOf } from "../project/place.ts";
import { loadProject } from "../project/rules.ts";
import type { CallRequest } from "../run/calls.ts";
import type { EventStore, RunRecord } from "../store/types.ts";
import { lastGo, lastSeq } from "./call-wait.ts";
import { detachRun, type DetachOptions, type Detached } from "./detach.ts";
import { detachResume, resumable } from "./resume.ts";

/** How many calls deep runs may go; files can call each other in a circle. */
export const MAX_CALL_DEPTH = 5;

export type StartOptions = {
  store: EventStore;
  runId: string;
  /** The project this run is in, which a call without `project` stays in. */
  place: ProjectPlace;
  newId: () => string;
  /** Tests stand in for starting a process. */
  detach?: ((options: DetachOptions) => Promise<Detached>) | undefined;
  /** Tests stand in for resuming a process. */
  resume?: ((run: RunRecord) => Promise<Detached>) | undefined;
};

export type Started =
  | { ok: true; id: string; project: string }
  | { ok: false; error: string };

/** What a call node had started when its run was stopped or crashed. */
export type AdoptedCall = {
  /** The runs whose result the caller did not keep, oldest first. */
  open: string[];
  /** The run it started last, which a conversation goes on with. */
  last: string;
  /** What the results it kept already counted of each run's cost. */
  counted: Map<string, number>;
};

/**
 * What a run being resumed had called, so its `workflow.call` nodes attach to
 * those runs again rather than start them twice. A node's result names its run.
 * A resume keeps a node's results up to its first failure (`resumeState`), and
 * a run stays open until one of those is its own, as parallel activations of
 * one call can each be.
 */
export const adoptedCalls = (
  store: EventStore,
  runId: string,
): ReadonlyMap<string, AdoptedCall> => {
  const adopted = new Map<string, AdoptedCall>();
  const closed = new Set<string>();
  for (const { event } of store.events(runId)) {
    if (event.type === "call.started") {
      const known = adopted.get(event.node);
      adopted.set(event.node, {
        open: [...(known?.open ?? []), event.run],
        last: event.run,
        counted: known?.counted ?? new Map<string, number>(),
      });
    }
    if (event.type === "node.finished") {
      if (!event.ok) closed.add(event.id);
      const known = adopted.get(event.id);
      const run = event.output["run"];
      if (known !== undefined && !closed.has(event.id)) {
        known.open = known.open.filter(open => open !== run);
        if (typeof run === "string") {
          known.counted.set(
            run,
            (known.counted.get(run) ?? 0) + (event.usage?.costUsd ?? 0),
          );
        }
      }
    }
  }
  return adopted;
};

/** What the called run's own `limits.budgetUsd` is capped to, and so on. */
const argsOf = (
  file: string,
  id: string,
  caller: string,
  request: CallRequest,
): string[] => [
  "run",
  file,
  "--run-id",
  id,
  "--called-by",
  caller,
  ...Object.entries(request.inputs).flatMap(([name, value]) => [
    "--input",
    `${name}=${value}`,
  ]),
  ...(request.budgetLeftUsd === undefined
    ? []
    : ["--budget-cap", String(request.budgetLeftUsd)]),
  ...(request.ref === undefined ? [] : ["--base-ref", request.ref]),
];

/** Why the target's `calls.accept` shuts this project out, or `null`. */
const notAccepted = (
  options: StartOptions,
  request: CallRequest,
  target: ProjectPlace,
): string | null => {
  const { store, place } = options;
  if (target.root === place.root) return null;
  const own = store.projects().find(({ root }) => root === place.root)?.id;
  const accept = loadProject(target.root, placeFiles(target).rules).project
    ?.calls?.accept;
  return accept === undefined || (own !== undefined && accept.includes(own))
    ? null
    : `Project ${String(request.project)} does not accept calls from ${own ?? place.root} (calls.accept in its project.yaml).`;
};

/** The end of what a failed process wrote, since its log can hold earlier goes. */
const lastLines = (text: string): string =>
  text.trim().split("\n").slice(-3).join(" ");

/** Whether the name can only be a file in the project's workflows folder. */
const isPlainName = (name: string): boolean =>
  name !== "" && name !== ".." && !/[/\\]/u.test(name);

/** Starts the called run; it may not have recorded `run.started` yet. */
export const startCall = async (
  options: StartOptions,
  request: CallRequest,
): Promise<Started> => {
  const { store, runId, place } = options;
  // A rendered name must not walk out of the folder `calls.accept` guards.
  if (!isPlainName(request.workflow)) {
    return {
      ok: false,
      error: `"${request.workflow}" is not a workflow's name.`,
    };
  }
  const target =
    request.project === undefined
      ? place
      : store.projects().find(({ id }) => id === request.project);
  if (target === undefined) {
    return {
      ok: false,
      error: `No registered project "${String(request.project)}"; register it there with ork register.`,
    };
  }
  const file = path.join(
    placeFiles(target).workflows,
    `${request.workflow}.ork.yaml`,
  );
  if (!existsSync(file)) {
    return {
      ok: false,
      error: `No workflow "${request.workflow}" in ${target.root}.`,
    };
  }
  if ((store.lookup(runId)[0]?.depth ?? 0) + 1 > MAX_CALL_DEPTH) {
    return {
      ok: false,
      error: `Calls nest too deep (${String(MAX_CALL_DEPTH)}); do these workflows call each other in a circle?`,
    };
  }
  const refused = notAccepted(options, request, target);
  if (refused !== null) return { ok: false, error: refused };
  const id = options.newId();
  const detached = await (options.detach ?? detachRun)({
    store,
    runId: id,
    args: argsOf(file, id, `${runId}/${request.callId}`, request),
    cwd: target.root,
    runDir: runDirOf(target, id),
  });
  return detached.ok
    ? { ok: true, id, project: target.root }
    : {
        ok: false,
        error: lastLines(detached.error) || "the run did not start",
      };
};

/**
 * A caller being resumed resumes what it called, as it does its own nodes: a
 * stop reached those runs too, and a failed one gets its retry. It reads what
 * such a run adds from then on. A run still going or already succeeded is left
 * as it is, and its latest go is read.
 */
export const reviveCall = async (
  options: StartOptions,
  id: string,
): Promise<{ ok: true; after: number } | { ok: false; error: string }> => {
  const { store } = options;
  const [run] = store.lookup(id);
  if (run === undefined) return { ok: false, error: `Run ${id} is gone.` };
  if (!resumable(store, run, {}).ok) {
    return { ok: true, after: lastGo(store, id) };
  }
  const after = lastSeq(store, id);
  const resume = options.resume ?? (r => detachResume(store, r, []));
  const resumed = await resume(run);
  return resumed.ok
    ? { ok: true, after }
    : {
        ok: false,
        error: `Run ${id} could not be resumed: ${lastLines(resumed.error) || "it did not start"}`,
      };
};
