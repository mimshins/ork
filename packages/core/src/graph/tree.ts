/**
 * @file The ownership tree's rules: who may own whom, unknown parents, cycles,
 *   and `isolation: continue` staying outside the tree.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { error } from "./diagnostics.ts";

/**
 * Ownership rules:
 *
 * - An `agent.subagent` is owned by an `agent.leader` or `agent.worker` (it runs
 *   inside that node's session);
 * - Every other owned node is owned by an `agent.leader`;
 * - The tree has no cycles;
 * - A node that sets `isolation: continue` neither owns nor is owned: it works in
 *   the worktree its input came from, outside the tree's merges.
 * - A leader's `questions:` is about its children's questions, so a leader with
 *   no `agent.leader` or `agent.worker` child can't set it.
 */
export const checkOwnership = (workflow: Workflow): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const { nodes } = workflow;

  for (const [id, node] of Object.entries(nodes)) {
    if (node.parent === undefined) continue;
    const path = ["nodes", id, "parent"];
    const owner = nodes[node.parent];
    if (node.parent === id) {
      diagnostics.push(error("tree.self", `\`${id}\` cannot own itself`, path));
    } else if (owner === undefined) {
      diagnostics.push(
        error("tree.unknown-parent", `unknown parent \`${node.parent}\``, path),
      );
    } else if (node.type === "agent.subagent") {
      if (owner.type !== "agent.leader" && owner.type !== "agent.worker") {
        diagnostics.push(
          error(
            "tree.owner-kind",
            `a sub-agent runs inside an \`agent.leader\` or \`agent.worker\` session, not a \`${owner.type}\``,
            path,
          ),
        );
      }
    } else if (owner.type !== "agent.leader") {
      diagnostics.push(
        error(
          "tree.owner-kind",
          `only an agent.leader can own a \`${node.type}\` (\`${node.parent}\` is a \`${owner.type}\`)`,
          path,
        ),
      );
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (!("isolation" in node) || node.isolation !== "continue") continue;
    const owns = Object.values(nodes).some(other => other.parent === id);
    if (node.parent !== undefined || owns) {
      diagnostics.push(
        error(
          "tree.continue",
          `\`${id}\` continues in its input's worktree, so it can neither own nodes nor have a parent`,
          ["nodes", id, "isolation"],
        ),
      );
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (node.type !== "agent.leader" || node.questions === undefined) continue;
    const asks = Object.values(nodes).some(
      other =>
        other.parent === id &&
        (other.type === "agent.leader" || other.type === "agent.worker"),
    );
    if (!asks) {
      diagnostics.push(
        error(
          "questions.no-children",
          `\`${id}\` sets \`questions\`, but owns no \`agent.leader\` or \`agent.worker\` whose questions it could take`,
          ["nodes", id, "questions"],
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
