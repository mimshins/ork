/**
 * @file What a walk says it found (RFC-009). An outcome it tried may never
 *   happen, and it can't try every one a run can have, so every finding is a
 *   warning and says only what the walk tried. It says nothing when the walk
 *   stopped early, or about what's behind a condition the walk couldn't make go
 *   both ways, or behind a node a leader may delegate to, as those are where it
 *   would most often be wrong.
 */

import type { Diagnostic } from "@krapht/ork-schema";

import { collectPaths } from "../expr/parse.ts";
import { fieldRead } from "../graph/condition-checks.ts";
import { warning } from "../graph/diagnostics.ts";
import { checkLoops } from "../graph/loops.ts";
import { nodeSays } from "../graph/says.ts";
import {
  type CompiledEdge,
  type CompiledGraph,
  forEachOf,
} from "../graph/types.ts";
import { STUCK_REASON } from "./routing.ts";

/** What a walk saw across all its paths. */
export type WalkTally = {
  /** Nodes that ran on some path. */
  ran: Set<string>;
  /** For each condition that reads something, which ways it went. */
  went: Map<string, { held: boolean; unheld: boolean }>;
  /** Nodes whose `watch.until` no outcome tried could make hold. */
  undecided: Set<string>;
  /** Loop edges taken on some path. */
  entered: Set<string>;
  /** Loop edges whose nodes a path went through and out of, not running out. */
  left: Set<string>;
};

export const newTally = (): WalkTally => ({
  ran: new Set(),
  went: new Map(),
  undecided: new Set(),
  entered: new Set(),
  left: new Set(),
});

export const linkOf = (edge: { from: string; to: string }): string =>
  `${edge.from} -> ${edge.to}`;

/** These nodes and everything after them, along any edge. */
const behind = (
  graph: CompiledGraph,
  starts: Iterable<string>,
): Set<string> => {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      queue.push(...(graph.nodes.get(id)?.outgoing ?? []).map(({ to }) => to));
    }
  }
  return seen;
};

/**
 * The fields a condition reads of its own source, or `null` if it reads
 * anything else. An input is chosen at run time, and another node's output
 * depends on what finished first and on rounds a walk cuts, so neither is
 * proved by a walk.
 */
const ownFields = ({ condition, from }: CompiledEdge): string[] | null => {
  const reads = (condition === undefined ? [] : collectPaths(condition)).map(
    segments => fieldRead({ kind: "path", segments }, from),
  );
  const own = reads.flatMap(read =>
    read !== null && read.id === from ? [read.field] : [],
  );
  return own.length === reads.length ? [...new Set(own)] : null;
};

/**
 * Whether a node is a gate, or passes one's answer on through routers and
 * splits.
 */
const fromGate = (graph: CompiledGraph, id: string): boolean => {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const at = queue.pop();
    const compiled =
      at === undefined || seen.has(at) ? undefined : graph.nodes.get(at);
    if (at !== undefined && compiled !== undefined) {
      seen.add(at);
      if (compiled.node.type === "human.gate") return true;
      if (passesThrough(graph, at)) {
        queue.push(...compiled.incoming.map(({ from }) => from));
      }
    }
  }
  return false;
};

/**
 * Whether going one way isn't for want of trying: one field, either how a node
 * ended or with a closed list of values, and not a gate's.
 */
const settled = (
  graph: CompiledGraph,
  says: ReturnType<typeof nodeSays>,
  from: string,
  fields: readonly string[],
): boolean => {
  const [only] = fields;
  if (only === undefined || fields.length > 1) return false;
  // A gate someone stops has no `choice`, and a walk doesn't try that.
  if (fromGate(graph, from)) return false;
  // A walk tries a few of a fanned node's mixes, not all of them.
  const node = graph.nodes.get(from)?.node;
  if (only !== "ok" && node !== undefined && forEachOf(node) !== undefined) {
    return false;
  }
  const said = says[from]?.fields.find(({ field }) => field === only);
  // A node can declare a field called `ok` of its own, which it then reports.
  if (only === "ok") return said === undefined;
  return said?.values !== undefined && said.open !== true;
};

const undecided = (
  graph: CompiledGraph,
  says: ReturnType<typeof nodeSays>,
  tally: WalkTally,
  eager: ReadonlySet<string>,
  edge: CompiledEdge,
): boolean => {
  if (edge.condition === undefined) return false;
  if (collectPaths(edge.condition).length === 0) return false;
  const fields = ownFields(edge);
  if (fields === null || eager.has(edge.from)) return true;
  const went = tally.went.get(linkOf(edge));
  return (
    went !== undefined &&
    went.held !== went.unheld &&
    !settled(graph, says, edge.from, fields)
  );
};

/**
 * Nodes that can run more than once on a path: what a loop edge reaches, and
 * what has more than one edge in.
 */
const repeated = (graph: CompiledGraph, tally: WalkTally): string[] => [
  ...graph.edges
    .filter(
      edge => edge.maxRounds !== undefined && tally.entered.has(linkOf(edge)),
    )
    .map(({ to }) => to),
  ...[...graph.nodes]
    .filter(
      ([, { node, incoming }]) =>
        node.type !== "control.join" &&
        incoming.filter(({ maxRounds }) => maxRounds === undefined).length > 1,
    )
    .map(([id]) => id),
];

/**
 * Joins behind a node that can run more than once. They can fill across rounds
 * a walk cuts or repeats, or when a later run overtakes a slower branch, an
 * order a walk doesn't try.
 */
const joinsAfterRepeats = (graph: CompiledGraph, tally: WalkTally): string[] =>
  [...behind(graph, repeated(graph, tally))].filter(
    id => graph.nodes.get(id)?.node.type === "control.join",
  );

const passesThrough = (graph: CompiledGraph, id: string): boolean => {
  const type = graph.nodes.get(id)?.node.type;
  return type === "control.router" || type === "control.split";
};

/**
 * The nodes whose output comes from a join that fires before all its inputs are
 * in, directly or through routers and splits. Whether it fires doesn't depend
 * on what finished first, but what it reports does, and a walk tries one
 * order.
 */
const fedByEagerJoins = (graph: CompiledGraph): Set<string> => {
  const fed = new Set<string>();
  const queue = [...graph.nodes]
    .filter(
      ([, { node }]) =>
        node.type === "control.join" && (node.mode ?? "all") !== "all",
    )
    .map(([id]) => id);
  while (queue.length > 0) {
    const id = queue.pop();
    if (id !== undefined && !fed.has(id)) {
      fed.add(id);
      queue.push(
        ...(graph.nodes.get(id)?.outgoing ?? [])
          .map(({ to }) => to)
          .filter(to => passesThrough(graph, to)),
      );
    }
  }
  return fed;
};

/**
 * Nothing can be proved after these. An undecided condition decides its node's
 * other edges too, as a first-match router's are.
 */
const unproved = (graph: CompiledGraph, tally: WalkTally): Set<string> => {
  const says = nodeSays(graph.workflow.nodes, graph.edges);
  const owned = [...graph.nodes]
    .filter(([, { node }]) => node.parent !== undefined)
    .map(([id]) => id);
  const eager = fedByEagerJoins(graph);
  const sources = graph.edges
    .filter(edge => undecided(graph, says, tally, eager, edge))
    .map(({ from }) => from);
  return behind(graph, [
    ...owned,
    ...sources,
    ...tally.undecided,
    ...joinsAfterRepeats(graph, tally),
  ]);
};

/** Whether what comes after a node holds anything unproved: a way out may be. */
const anyBehind = (
  graph: CompiledGraph,
  from: string,
  hidden: ReadonlySet<string>,
): boolean => [...behind(graph, [from])].some(id => hidden.has(id));

/** `walk.never-runs` and `walk.only-rounds`, for a walk that didn't stop early. */
export const walkFindings = (
  graph: CompiledGraph,
  tally: WalkTally,
): Diagnostic[] => {
  const hidden = unproved(graph, tally);
  const neverRuns = [...graph.nodes.keys()]
    .filter(id => !tally.ran.has(id) && !hidden.has(id))
    .map(id =>
      warning("walk.never-runs", `no way the walk tried reaches \`${id}\``, [
        "nodes",
        id,
      ]),
    );
  // The compiler already said this of a loop with no condition at all.
  const said = new Set(
    checkLoops(graph.workflow, graph.edges)
      .filter(({ code }) => code === "loop.no-condition")
      .map(({ path }) => path[1]),
  );
  const onlyRounds = graph.edges
    .filter(
      edge =>
        edge.maxRounds !== undefined &&
        // Off a cycle, another loop decides how often its source runs.
        behind(graph, [edge.to]).has(edge.from) &&
        tally.entered.has(linkOf(edge)) &&
        !tally.left.has(linkOf(edge)) &&
        !anyBehind(graph, edge.from, hidden) &&
        !said.has(edge.source),
    )
    .map(edge =>
      warning(
        "walk.only-rounds",
        `every way the walk tried through the loop \`${linkOf(edge)}\` ran out of rounds`,
        ["edges", edge.source],
      ),
    );
  return [...neverRuns, ...onlyRounds];
};

/** Whether a run ended with a node still waiting, which only a bug causes. */
export const leftWaiting = (result: { reasons: readonly string[] }): boolean =>
  result.reasons.some(reason => reason.startsWith(STUCK_REASON));

/** A path that never settled, which only a bug in the scheduler can cause. */
export const unfinished = (choices: readonly string[]): Diagnostic =>
  warning(
    "walk.unfinished",
    `the walk got stuck on one way through this workflow${choices.length === 0 ? "" : ` (${choices.map(choice => `\`${choice}\``).join(", ")})`}. This is a bug in Ork, not in the workflow`,
    [],
  );
