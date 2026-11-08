/**
 * @file What a walk works out once and shares between its paths (RFC-009): the
 *   graph it runs, what each node can end as, and which edges and conditions
 *   matter to what it reports.
 */

import { collectPaths, type Expr, parseExpr } from "../expr/parse.ts";
import { fieldRead } from "../graph/condition-checks.ts";
import { stronglyConnected } from "../graph/flow.ts";
import { type CompiledGraph, forEachOf } from "../graph/types.ts";
import type { Inputs } from "./types.ts";
import { linkOf, type WalkTally } from "./walk-findings.ts";
import type { Outcome } from "./walk-outcomes.ts";

/** What a walk shares between its paths. */
export type WalkPlan = {
  /** The graph as walked: no `watch:`, and `maxRounds` cut to what branches. */
  graph: CompiledGraph;
  inputs: Inputs;
  outcomes: ReadonlyMap<string, readonly Outcome[]>;
  /** Each watched node's condition: what a wait ends on. */
  untils: ReadonlyMap<string, Expr>;
  /** The edges whose condition reads something: only those can go one way. */
  reading: ReadonlySet<string>;
  /** Each loop edge, and the nodes that loop with it. */
  loopGroups: ReadonlyMap<string, ReadonlySet<string>>;
  /** When the walk runs out of time, by `performance.now()`. */
  deadline: number;
  tally: WalkTally;
  /** Node id, then the history of first rounds its second round branches for. */
  secondRounds: Map<string, string>;
};

/** Each watched node's condition, parsed. */
export const untilsOf = (graph: CompiledGraph): ReadonlyMap<string, Expr> =>
  new Map(
    [...graph.nodes].flatMap(([id, { node }]) => {
      // Each item of a fanned node waits on its own; the walk has one node.
      const watched = "watch" in node && forEachOf(node) === undefined;
      const until = watched ? node.watch?.until : undefined;
      const parsed = until === undefined ? null : parseExpr(until);
      return parsed?.ok === true ? [[id, parsed.expr] as const] : [];
    }),
  );

/** Watched nodes whose `until` reads anything but their own look. */
export const untilsReadingOthers = (graph: CompiledGraph): string[] =>
  [...untilsOf(graph)]
    .filter(([id, until]) =>
      collectPaths(until).some(
        segments => fieldRead({ kind: "path", segments }, id)?.id !== id,
      ),
    )
    .map(([id]) => id);

/** Each loop edge, and the nodes that loop with it. */
export const loopGroupsOf = (
  graph: CompiledGraph,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const groups = stronglyConnected([...graph.nodes.keys()], graph.edges).map(
    group => new Set(group),
  );
  return new Map(
    graph.edges
      .filter(({ maxRounds }) => maxRounds !== undefined)
      .map(edge => [
        linkOf(edge),
        groups.find(group => group.has(edge.from)) ?? new Set([edge.from]),
      ]),
  );
};

/** The edges whose condition reads something. */
export const readers = (graph: CompiledGraph): Set<string> =>
  new Set(
    graph.edges
      .filter(
        ({ condition }) =>
          condition !== undefined && collectPaths(condition).length > 0,
      )
      .map(edge => linkOf(edge)),
  );
