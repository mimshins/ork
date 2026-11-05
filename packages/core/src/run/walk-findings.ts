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
 * Whether the walk tried all a condition can read: one field, either how its
 * node ended or with a closed list of values. Then going one way isn't for want
 * of trying. With two fields it may be: a failed node can still carry values,
 * and failures aren't tried with each of them.
 */
const triedAll = (
  says: ReturnType<typeof nodeSays>,
  edge: CompiledEdge,
): boolean => {
  const reads = (
    edge.condition === undefined ? [] : collectPaths(edge.condition)
  ).map(segments => fieldRead({ kind: "path", segments }, edge.from));
  const fields = new Set(reads.map(read => `${read?.id}.${read?.field}`));
  const [read] = reads;
  if (fields.size !== 1 || read === null || read === undefined) return false;
  const said = says[read.id]?.fields.find(({ field }) => field === read.field);
  return (
    read.field === "ok" || (said?.values !== undefined && said.open !== true)
  );
};

/**
 * Nothing can be proved after these. A one-way condition may only have gone one
 * way for what the walk tried, and it decides its node's other edges too, as a
 * first-match router's are.
 */
const unproved = (graph: CompiledGraph, tally: WalkTally): Set<string> => {
  const says = nodeSays(graph.workflow.nodes, graph.edges);
  const owned = [...graph.nodes]
    .filter(([, { node }]) => node.parent !== undefined)
    .map(([id]) => id);
  const oneWay = graph.edges
    .filter(edge => {
      const went = tally.went.get(linkOf(edge));
      return (
        went !== undefined && went.held !== went.unheld && !triedAll(says, edge)
      );
    })
    .map(({ from }) => from);
  return behind(graph, [...owned, ...oneWay, ...tally.undecided]);
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
