import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { error } from "./diagnostics.ts";

/**
 * Ownership rules:
 *
 * - A `claude.subagent` is owned by a `claude.leader` or `claude.worker` (it runs
 *   inside that node's session);
 * - Every other owned node is owned by a `claude.leader`;
 * - The tree has no cycles.
 */
export const checkOwnership = (workflow: Workflow): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const { nodes } = workflow;

  for (const [id, node] of Object.entries(nodes)) {
    if (node.parent === undefined) continue;
    const path = ["nodes", id, "parent"];
    const owner = nodes[node.parent];
    if (node.parent === id) {
      diagnostics.push(error("tree.self", `"${id}" cannot own itself`, path));
    } else if (owner === undefined) {
      diagnostics.push(
        error("tree.unknown-parent", `unknown parent "${node.parent}"`, path),
      );
    } else if (node.type === "claude.subagent") {
      if (owner.type !== "claude.leader" && owner.type !== "claude.worker") {
        diagnostics.push(
          error(
            "tree.owner-kind",
            `a sub-agent runs inside a claude.leader or claude.worker session, not a ${owner.type}`,
            path,
          ),
        );
      }
    } else if (owner.type !== "claude.leader") {
      diagnostics.push(
        error(
          "tree.owner-kind",
          `only a claude.leader can own a ${node.type} ("${node.parent}" is a ${owner.type})`,
          path,
        ),
      );
    }
  }

  // Cycle check: follow parents from every node.
  const reported = new Set<string>();
  for (const start of Object.keys(nodes)) {
    const seen: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && nodes[current] !== undefined) {
      if (seen.includes(current)) {
        const loop = seen.slice(seen.indexOf(current));
        const key = loop.toSorted().join(",");
        if (!reported.has(key) && loop.length > 1) {
          reported.add(key);
          diagnostics.push(
            error(
              "tree.cycle",
              `ownership cycle: ${[...loop, current].join(" -> ")}`,
              ["nodes", current, "parent"],
            ),
          );
        }
        break;
      }
      seen.push(current);
      current = nodes[current]?.parent;
    }
  }
  return diagnostics;
};

/** The owner chain of a node, nearest first. Stops on cycles. */
export const ownersOf = (workflow: Workflow, id: string): string[] => {
  const owners: string[] = [];
  let current = workflow.nodes[id]?.parent;
  while (current !== undefined && !owners.includes(current) && current !== id) {
    owners.push(current);
    current = workflow.nodes[current]?.parent;
  }
  return owners;
};
