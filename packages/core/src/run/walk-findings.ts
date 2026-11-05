/**
 * @file What a walk says it found (RFC-009). An outcome it tried may never
 *   happen, so every finding is a warning. Saying a node never runs is a claim
 *   about every way through, so it's only made when it's proved: not when the
 *   walk stopped early, and not for what's behind a condition the walk couldn't
 *   make go both ways, or behind a node a leader may delegate to.
 */

import type { Diagnostic } from "@krapht/ork-schema";

import { collectPaths } from "../expr/parse.ts";
import { fieldRead } from "../graph/condition-checks.ts";
import { warning } from "../graph/diagnostics.ts";
import { checkLoops } from "../graph/loops.ts";
import { nodeSays } from "../graph/says.ts";
import type { CompiledEdge, CompiledGraph } from "../graph/types.ts";

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
  /** Loop edges on a path that succeeded without them running out. */
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
 * Whether going one way isn't for want of trying: one field, either how a node
 * ended or with a closed list of values. A gate's failure isn't tried. With two
 * fields it may be: failures aren't tried with each of a node's values.
 */
const settled = (
  graph: CompiledGraph,
  says: ReturnType<typeof nodeSays>,
  from: string,
  fields: readonly string[],
): boolean => {
  const [only] = fields;
  if (only === undefined || fields.length > 1) return false;
  if (only === "ok") {
    return graph.nodes.get(from)?.node.type !== "human.gate";
  }
  const said = says[from]?.fields.find(({ field }) => field === only);
  return said?.values !== undefined && said.open !== true;
};

const undecided = (
  graph: CompiledGraph,
  says: ReturnType<typeof nodeSays>,
  tally: WalkTally,
  edge: CompiledEdge,
): boolean => {
  if (edge.condition === undefined) return false;
  if (collectPaths(edge.condition).length === 0) return false;
  const fields = ownFields(edge);
  if (fields === null) return true;
  const went = tally.went.get(linkOf(edge));
  return (
    went !== undefined &&
    went.held !== went.unheld &&
    !settled(graph, says, edge.from, fields)
  );
};

/**
 * Joins a loop can feed. A join remembers its inputs between rounds, so it may
 * fill only across rounds a walk cuts or repeats. Nothing else remembers: every
 * other node goes where its own latest output says.
 */
const joinsAfterLoops = (graph: CompiledGraph, tally: WalkTally): string[] => {
  const entered = graph.edges
    .filter(
      edge => edge.maxRounds !== undefined && tally.entered.has(linkOf(edge)),
    )
    .map(({ to }) => to);
  return [...behind(graph, entered)].filter(
    id => graph.nodes.get(id)?.node.type === "control.join",
  );
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
  const sources = graph.edges
    .filter(edge => undecided(graph, says, tally, edge))
    .map(({ from }) => from);
  return behind(graph, [
    ...owned,
    ...sources,
    ...tally.undecided,
    ...joinsAfterLoops(graph, tally),
  ]);
};

/** `walk.never-runs` and `walk.only-rounds`, for a walk that tried every way. */
export const walkFindings = (
  graph: CompiledGraph,
  tally: WalkTally,
): Diagnostic[] => {
  const hidden = unproved(graph, tally);
  const neverRuns = [...graph.nodes.keys()]
    .filter(id => !tally.ran.has(id) && !hidden.has(id))
    .map(id =>
      warning(
        "walk.never-runs",
        `\`${id}\` never runs: no way through this workflow reaches it`,
        ["nodes", id],
      ),
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
        tally.entered.has(linkOf(edge)) &&
        !tally.left.has(linkOf(edge)) &&
        !hidden.has(edge.from) &&
        !said.has(edge.source),
    )
    .map(edge =>
      warning(
        "walk.only-rounds",
        `every way through the loop \`${linkOf(edge)}\` ends with it running out of rounds`,
        ["edges", edge.source],
      ),
    );
  return [...neverRuns, ...onlyRounds];
};

/** A path that never settled, which only a bug in the scheduler can cause. */
export const unfinished = (choices: readonly string[]): Diagnostic =>
  warning(
    "walk.unfinished",
    `the walk got stuck on one way through this workflow${choices.length === 0 ? "" : ` (${choices.map(choice => `\`${choice}\``).join(", ")})`}. This is a bug in Ork, not in the workflow`,
    [],
  );
