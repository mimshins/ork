/**
 * @file The walk (RFC-009): every way through a workflow, on the real
 *   scheduler, with no session, tool, script, workspace or store. Each path is
 *   one `startRun`; the next path replays the choices before the last one that
 *   has another way to go. Only a loop's first rounds branch, so a large
 *   `maxRounds` costs nothing. A walk proves what the graph does for an
 *   outcome, not that the outcome will occur.
 */

import { setImmediate as nextTurn } from "node:timers/promises";

import type { Diagnostic, Node, Workflow } from "@krapht/ork-schema";

import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";
import type { RunHandle } from "./handle.ts";
import { startRun } from "./scheduler.ts";
import type { Inputs, RunResult, RunStatus } from "./types.ts";
import {
  leftWaiting,
  newTally,
  unfinished,
  walkFindings,
  type WalkTally,
} from "./walk-findings.ts";
import { outcomesOf } from "./walk-outcomes.ts";
import { BRANCHING_ROUNDS, createPath, type Decision } from "./walk-path.ts";
import {
  loopGroupsOf,
  readers,
  untilsOf,
  untilsReadingOthers,
  type WalkPlan,
} from "./walk-plan.ts";

/** Where a walk stops and says it did: twelve parallel nodes just fit. */
export const WALK_PATH_CAP = 4096;

/** How long a walk may take, as paths cost more the more nodes they run. */
export const WALK_TIME_CAP_MS = 1000;

/** How long a path may go without settling. A stand-in never waits. */
const SETTLE_MS = 1000;

/** How long a walk holds the process before others get a turn. */
const TURN_MS = 16;

const verbed = (number: number, verb: string): string =>
  `${number.toLocaleString("en-US")} ${verb}${number === 1 ? "s" : ""}`;

/** What a walk comes to, in the words every place shows it in. */
export const walkSummary = ({
  paths,
  complete,
  succeeded,
  failed,
}: WalkResult): string => {
  const ways = `${paths.toLocaleString("en-US")} ${paths === 1 ? "way" : "ways"}`;
  if (!complete)
    return `Walked ${ways} through and stopped; not every way was tried.`;
  return `Walked ${ways} through: ${verbed(succeeded, "succeed")}, ${verbed(failed, "fail")}.`;
};

/** One way a run can end: how, what didn't run, and one way to get there. */
export type WalkEnding = {
  status: RunStatus;
  notRun: string[];
  /** The choices of the first path that ended this way. */
  choices: string[];
  /** How many paths ended this way. */
  paths: number;
};

export type WalkResult = {
  /** How many ways through it tried. */
  paths: number;
  /** False if it stopped early, when it claims nothing is absent. */
  complete: boolean;
  succeeded: number;
  failed: number;
  endings: WalkEnding[];
  findings: Diagnostic[];
};

export type WalkOptions = {
  cap?: number;
  /** How long it may take, even within one path. */
  maxMs?: number;
  settleMs?: number;
  /** For tests: what starts a path's run. */
  start?: typeof startRun;
};

const withoutWatch = (node: Node): Node => {
  if (!("watch" in node)) return node;
  const { watch: _watch, ...rest } = node;
  return rest;
};

const cutRounds = (edge: CompiledEdge): CompiledEdge =>
  edge.maxRounds === undefined
    ? edge
    : { ...edge, maxRounds: Math.min(edge.maxRounds, BRANCHING_ROUNDS) };

const concurrencyOf = ({ limits }: Workflow) =>
  limits?.concurrency === undefined ? {} : { concurrency: limits.concurrency };

const walkedNode = (
  compiled: NonNullable<ReturnType<CompiledGraph["nodes"]["get"]>>,
) => ({
  ...compiled,
  node: withoutWatch(compiled.node),
  incoming: compiled.incoming.map(edge => cutRounds(edge)),
  outgoing: compiled.outgoing.map(edge => cutRounds(edge)),
});

/**
 * The graph as a walk runs it. A `watch:` would wait in real time, so the
 * stand-in does its work (`walk-path.ts`), and the workflow it reads keeps the
 * condition.
 */
const walkedGraph = (graph: CompiledGraph): CompiledGraph => ({
  ...graph,
  // A stand-in spends nothing and takes no time, so no budget or timer applies.
  workflow: {
    ...graph.workflow,
    limits: concurrencyOf(graph.workflow),
  },
  edges: graph.edges.map(edge => cutRounds(edge)),
  nodes: new Map(
    [...graph.nodes].map(([id, compiled]) => [id, walkedNode(compiled)]),
  ),
});

/** Inputs for a walk: their defaults, or an empty value of their type. */
const inputsOf = (workflow: Workflow): Inputs =>
  Object.fromEntries(
    Object.entries(workflow.inputs ?? {}).map(([name, input]) => {
      if (input.default !== undefined) return [name, input.default];
      if (input.type === "number") return [name, 0];
      return [name, input.type === "boolean" ? false : ""];
    }),
  );

/** The next path: the last choice with another way to go, and those before. */
const nextPath = (decisions: readonly Decision[]): Decision[] | null => {
  for (let at = decisions.length - 1; at >= 0; at -= 1) {
    const decision = decisions[at];
    if (decision !== undefined && decision.index + 1 < decision.count) {
      return [
        ...decisions.slice(0, at),
        { ...decision, index: decision.index + 1 },
      ];
    }
  }
  return null;
};

/** The run's end, or `null` if it hasn't settled in time. */
const settled = async (
  handle: RunHandle,
  ms: number,
): Promise<RunResult | null> => {
  const { promise, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => {
    resolve(null);
  }, ms);
  try {
    return await Promise.race([handle.done, promise]);
  } finally {
    clearTimeout(timer);
  }
};

/** Nodes a walk can say didn't run: a leader may delegate to the rest. */
const walkableNodes = (graph: CompiledGraph): string[] =>
  [...graph.nodes]
    .filter(([, { node }]) => node.parent === undefined)
    .map(([id]) => id);

const recordEnding = (
  endings: Map<string, WalkEnding>,
  status: RunStatus,
  notRun: string[],
  choices: string[],
): void => {
  const key = JSON.stringify([status, notRun]);
  const ending = endings.get(key);
  if (ending === undefined) {
    endings.set(key, { status, notRun, choices, paths: 1 });
  } else {
    ending.paths += 1;
  }
};

const findingsOf = (
  graph: CompiledGraph,
  tally: WalkTally,
  complete: boolean,
  stuck: readonly string[] | null,
): Diagnostic[] => {
  if (stuck !== null) return [unfinished(stuck)];
  return complete ? walkFindings(graph, tally) : [];
};

/** Tries every way through a workflow, up to a cap, and says what it found. */
export const walkWorkflow = async (
  graph: CompiledGraph,
  options: WalkOptions = {},
): Promise<WalkResult> => {
  const cap = options.cap ?? WALK_PATH_CAP;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const deadline = performance.now() + (options.maxMs ?? WALK_TIME_CAP_MS);
  const start = options.start ?? startRun;
  const tally = newTally();
  const walked = walkedGraph(graph);
  const { outcomes, cutShort } = outcomesOf(graph);
  // Not every value was tried, so a closed list doesn't settle anything here.
  for (const id of cutShort) tally.undecided.add(id);
  // An input or another node can end a wait, and a walk doesn't vary those.
  for (const id of untilsReadingOthers(graph)) tally.undecided.add(id);
  const plan: WalkPlan = {
    graph: walked,
    inputs: inputsOf(graph.workflow),
    outcomes,
    untils: untilsOf(graph),
    reading: readers(graph),
    loopGroups: loopGroupsOf(graph),
    deadline,
    tally,
    secondRounds: new Map(),
  };
  const walkable = walkableNodes(graph);
  const endings = new Map<string, WalkEnding>();
  const counts = { paths: 0, succeeded: 0, failed: 0 };
  let given: Decision[] | null = [];
  let stuck: string[] | null = null;
  let overran = false;
  let turn = performance.now();

  while (
    given !== null &&
    counts.paths < cap &&
    stuck === null &&
    !overran &&
    (counts.paths === 0 || performance.now() < deadline)
  ) {
    const path = createPath(plan, given);
    const handle = start(path.options);
    path.stopWith(() => {
      handle.interrupt();
    });
    // One path at a time: each replays what the last one chose.
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above
    const result = await settled(handle, settleMs);
    if (result === null) {
      handle.interrupt();
      stuck = path.said;
    } else if (leftWaiting(result)) {
      // The scheduler left a node waiting: a bug, never a way to end.
      stuck = path.said;
    } else if (path.overran()) {
      overran = true;
    } else {
      counts.paths += 1;
      const succeeded = result.status === "succeeded";
      counts[succeeded ? "succeeded" : "failed"] += 1;
      path.finish(succeeded);
      const notRun = walkable.filter(id => !path.started.has(id));
      recordEnding(endings, result.status, notRun, path.said);
      given = nextPath(path.decisions);
    }
    if (performance.now() - turn > TURN_MS) {
      // A long walk leaves room for the rest of the process.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await nextTurn();
      turn = performance.now();
    }
  }

  const complete = given === null && stuck === null && !overran;
  return {
    ...counts,
    complete,
    endings: [...endings.values()],
    findings: findingsOf(graph, tally, complete, stuck),
  };
};
