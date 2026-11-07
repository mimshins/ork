/**
 * @file What the Monitor works out from a run's tree: each node's status and
 *   card, the tree as rows, the graph with its spawned workers in it, which
 *   controls apply just now and why the others do not, and what is worth saying
 *   aloud when the run changes.
 */

import type {
  DecisionRecord,
  RunView,
  TreeNode,
  WorkflowGraph,
} from "@krapht/ork-server/client";

import { type Status, statusWord } from "../components/status-badge.tsx";
import type { NodeFacts } from "../graph/facts.ts";
import type { GraphInput } from "../graph/types.ts";

export type TreeRow = {
  node: TreeNode;
  depth: number;
  /** Its owner, for moving to it with the keys. */
  parent: string | undefined;
};

/** The tree as rows, top to bottom, without what `collapsed` hides. */
export const rowsOf = (
  roots: readonly TreeNode[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow[] => {
  const walk = (
    nodes: readonly TreeNode[],
    depth: number,
    parent?: string,
  ): TreeRow[] =>
    nodes.flatMap(node => [
      { node, depth, parent },
      ...(collapsed.has(node.id)
        ? []
        : walk(node.children, depth + 1, node.id)),
    ]);
  return walk(roots, 1);
};

const STATES: Readonly<Record<TreeNode["state"], Status>> = {
  waiting: "queued",
  running: "running",
  ok: "succeeded",
  failed: "failed",
  skipped: "skipped",
};

/** What a node that was not done when its run ended came to. */
const LEFT: Partial<Record<TreeNode["state"], Status>> = {
  waiting: "skipped",
  running: "interrupted",
};

export const statusOf = (
  node: TreeNode,
  waitingOnYou: boolean,
  runEnded = false,
): Status => {
  const left = runEnded ? LEFT[node.state] : undefined;
  if (left !== undefined) return left;
  if (node.held === true) return "paused";
  return waitingOnYou ? "waiting" : STATES[node.state];
};

/** The nodes of this run with a question open. */
export const askingNodes = (
  decisions: readonly DecisionRecord[] | null,
  runId: string,
): ReadonlySet<string> =>
  new Set(
    (decisions ?? [])
      .filter(decision => decision.runId === runId)
      .map(decision => decision.node),
  );

export const factsOf = (
  roots: readonly TreeNode[],
  asking: ReadonlySet<string>,
  runId: string,
  runEnded = false,
): Map<string, NodeFacts> =>
  new Map(
    rowsOf(roots).map(({ node }) => {
      const tokens = node.inputTokens + node.outputTokens;
      return [
        node.id,
        {
          status: statusOf(node, asking.has(node.id), runEnded),
          model: node.model,
          tokens: tokens === 0 ? undefined : tokens,
          costUsd: node.costUsd === 0 ? undefined : node.costUsd,
          cli: `ork logs ${runId} --node ${node.id}`,
        },
      ];
    }),
  );

/** How a run stands, for telling what changed. */
export type Standing = {
  run: Status;
  nodes: ReadonlyMap<string, Status>;
};

export const standingOf = (
  run: Status,
  facts: ReadonlyMap<string, NodeFacts>,
): Standing => ({
  run,
  nodes: new Map([...facts].map(([id, { status }]) => [id, status])),
});

/** What of a node is news here: a question open is a notification already. */
const NEWS: ReadonlySet<Status> = new Set(["failed", "paused"]);

/**
 * What changed that should be said aloud, a sentence each. A run ending or
 * pausing is a notification, which says so across runs, so this adds only its
 * going on again and what happens to its nodes.
 */
export const changesOf = (
  runId: string,
  before: Standing,
  now: Standing,
): string[] => [
  ...(now.run === before.run || now.run !== "running"
    ? []
    : [`Run ${runId} ${statusWord(now.run)}.`]),
  ...[...now.nodes]
    .filter(
      ([id, status]) =>
        status !== before.nodes.get(id) &&
        NEWS.has(status) &&
        // A whole run pausing is one piece of news.
        !(status === "paused" && now.run === "paused"),
    )
    .map(([id, status]) => `${id} ${statusWord(status)}.`),
];

/** A run's status, with a question open read as it is in the Runs panel. */
export const runStatusOf = (
  { live }: Pick<RunView, "live">,
  waitingOnYou: boolean,
): Status => (live === "running" && waitingOnYou ? "waiting" : live);

/** The declared graph, and the workers the run has spawned so far. */
export const graphInputOf = (
  graph: WorkflowGraph,
  roots: readonly TreeNode[],
): GraphInput => {
  const known = new Set(graph.nodes.map(node => node.id));
  const spawned = rowsOf(roots)
    .map(({ node }) => node)
    .filter(node => !known.has(node.id))
    .map(({ id, type, parent }) => ({ id, type, parent }));
  return { ...graph, nodes: [...graph.nodes, ...spawned] };
};

export type Action = { enabled: true } | { enabled: false; why: string };

export type Actions = {
  pause: Action;
  proceed: Action;
  stop: Action;
  /** A whole run's, once it has ended without succeeding: `ork resume`. */
  resume?: Action;
};

const YES: Action = { enabled: true };
const no = (why: string): Action => ({ enabled: false, why });

const isLive = ({ live }: RunView): boolean =>
  live === "running" || live === "paused";

/**
 * Whether `ork resume` would take an ended run, by its refusals: one that
 * succeeded has nothing to resume, and one that ran a single node is run
 * again.
 */
const resumeOf = (run: RunView): Action =>
  run.id.startsWith("node-")
    ? no("it ran one node; run that node again instead")
    : YES;

export const runActions = (run: RunView): Actions => {
  if (!isLive(run)) {
    const why = `the run has ended (${run.live})`;
    const ended = { pause: no(why), proceed: no(why), stop: no(why) };
    return run.live === "succeeded"
      ? ended
      : { ...ended, resume: resumeOf(run) };
  }
  const paused = run.live === "paused";
  return {
    pause: paused ? no("the run is paused") : YES,
    proceed: paused ? YES : no("the run is not paused"),
    stop: YES,
  };
};

export const nodeActions = (run: RunView, node: TreeNode): Actions => {
  if (!isLive(run)) {
    const why = `the run has ended (${run.live})`;
    return { pause: no(why), proceed: no(why), stop: no(why) };
  }
  if (node.state !== "running" && node.state !== "waiting") {
    const why = `${node.id} has finished`;
    return { pause: no(why), proceed: no(why), stop: no(why) };
  }
  const paused = node.held === true || run.paused.nodes.includes(node.id);
  const stop = node.state === "running" ? YES : no(`${node.id} is not running`);
  if (run.live === "paused") {
    const why = "the whole run is paused; continue the run";
    return { pause: no(why), proceed: no(why), stop };
  }
  return {
    pause: paused ? no(`${node.id} is paused`) : YES,
    proceed: paused ? YES : no(`${node.id} is not paused`),
    stop,
  };
};

/** Whether a node takes a note: one that never ran has done nothing to note. */
export const noteAction = (node: TreeNode): Action =>
  node.state === "waiting" || node.state === "skipped"
    ? no("it hasn't run")
    : YES;
