/**
 * @file The checks on where a `forEach` node sits (RFC-013): items can't share
 *   one worktree at once, a fanned child needs an edge into it, and its items
 *   merge into an owner that isn't waiting on them.
 */

import type { Diagnostic, Node, Workflow } from "@krapht/ork-schema";

import { error } from "./diagnostics.ts";
import { ancestorsOf } from "./flow.ts";
import type { CompiledEdge } from "./types.ts";

/** The isolation a node runs under. */
const isolationOf = (workflow: Workflow, node: Node): string =>
  ("isolation" in node ? node.isolation : undefined) ??
  workflow.defaults?.isolation ??
  "worktree";

/** Where a fanned node sits: what it shares, and how it comes to run. */
export const checkPlace = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  id: string,
  node: Node,
  maxParallel: number | undefined,
): Diagnostic[] => {
  const found: Diagnostic[] = [];
  if (isolationOf(workflow, node) === "continue" && maxParallel !== 1) {
    found.push(
      error(
        "forEach.continue",
        `${id} continues one worktree, so its items can't run at once: set \`maxParallel: 1\` or use \`isolation: worktree\`.`,
        ["nodes", id, "isolation"],
      ),
    );
  }
  if (node.parent === undefined) return found;
  const parent = ["nodes", id, "parent"];
  if (!edges.some(edge => edge.to === id)) {
    found.push(
      error(
        "forEach.unreached",
        `${id} never runs: a leader can't delegate to a fanned node, so it needs an edge into it.`,
        parent,
      ),
    );
    return found;
  }
  const owner = workflow.nodes[node.parent];
  const hasTree =
    owner !== undefined &&
    ["worktree", "continue"].includes(isolationOf(workflow, owner));
  if (hasTree && ancestorsOf(node.parent, edges).has(id)) {
    found.push(
      error(
        "forEach.owner-order",
        `${id}'s items merge into ${node.parent}, which can only start after ${id} has finished: reverse that order.`,
        parent,
      ),
    );
  }
  return found;
};
