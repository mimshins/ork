/**
 * @file The checks on a loop's shape (RFC-009): one nothing can end but running
 *   out of rounds, a plain edge that fires on every round, and a loop of
 *   sessions with nothing to cap what it spends. All are warnings: each can be
 *   meant, and none stops the run.
 */

import {
  type Diagnostic,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import { alwaysHolds } from "./condition-checks.ts";
import { warning } from "./diagnostics.ts";
import { stronglyConnected } from "./flow.ts";
import { type CompiledEdge, itemCountOf } from "./types.ts";

/** The sessions one pass through these nodes can start, with owned ones. */
const sessionsIn = (
  workflow: Workflow,
  members: ReadonlySet<string>,
): number => {
  const ownedByMember = (id: string): boolean => {
    const parent = workflow.nodes[id]?.parent;
    return (
      parent !== undefined && (members.has(parent) || ownedByMember(parent))
    );
  };
  return Object.entries(workflow.nodes)
    .filter(
      ([id, node]) =>
        isClaudeNode(node) &&
        node.type !== "claude.subagent" &&
        (members.has(id) || ownedByMember(id)),
    )
    .reduce((sum, [, node]) => sum + itemCountOf(node), 0);
};

/** Plain edges beside a loop edge. A first-match router's is its fallback. */
const besideLoops = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  loops: readonly CompiledEdge[],
): CompiledEdge[] => {
  const sources = new Set(
    loops
      .map(({ from }) => from)
      .filter(from => {
        const node = workflow.nodes[from];
        return !(
          node?.type === "control.router" && (node.mode ?? "first") === "first"
        );
      }),
  );
  return edges.filter(
    edge =>
      sources.has(edge.from) &&
      edge.maxRounds === undefined &&
      alwaysHolds(edge),
  );
};

/** What's wrong with the shape of one group of nodes that loop together. */
const checkGroup = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  component: readonly string[],
): Diagnostic[] => {
  const members = new Set(component);
  const inside = edges.filter(
    ({ from, to }) => members.has(from) && members.has(to),
  );
  const loops = inside.filter(({ maxRounds }) => maxRounds !== undefined);
  const [first] = loops;
  if (first === undefined) return [];
  const { limits } = workflow;
  const capped =
    limits?.budgetUsd !== undefined || limits?.timeout !== undefined;
  const rounds = loops.reduce((sum, e) => sum + (e.maxRounds ?? 0), 0);
  const sessions = sessionsIn(workflow, members) * (1 + rounds);
  const noCondition = inside.every(edge => alwaysHolds(edge))
    ? loops.map(({ from, to, maxRounds, source }) =>
        warning(
          "loop.no-condition",
          `the loop \`${from} -> ${to}\` has no condition, so it can only end by running out of its ${String(maxRounds)} rounds`,
          ["edges", source],
        ),
      )
    : [];
  const beside = besideLoops(workflow, edges, loops).map(
    ({ from, to, source }) =>
      warning(
        "loop.beside-edge",
        `\`${from} -> ${to}\` fires on every round of the loop from \`${from}\`; to leave once, give it a condition`,
        ["edges", source],
      ),
  );
  const uncapped =
    capped || sessions === 0
      ? []
      : [
          warning(
            "loop.uncapped",
            `this loop can start about ${String(sessions)} sessions, with no \`limits.budgetUsd\` or \`limits.timeout\` to stop them`,
            ["edges", first.source],
          ),
        ];
  return [...noCondition, ...beside, ...uncapped];
};

/** What's wrong with the shape of each group of nodes that loop together. */
export const checkLoops = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] =>
  stronglyConnected(Object.keys(workflow.nodes), edges).flatMap(component =>
    checkGroup(workflow, edges, component),
  );
