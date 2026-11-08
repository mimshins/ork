/**
 * @file Which programs a node runs: its own, its `before:` and its `verify:`,
 *   with what it takes from the workflow's defaults.
 */

import { isToolNode, type Node } from "./nodes.ts";
import type { Step } from "./steps.ts";

/** Each program a node itself declares, and where under the node it is. */
export const programsOf = (
  node: Node,
): { at: readonly string[]; program: Step }[] => {
  if (isToolNode(node)) return [{ at: [], program: node }];
  // An MCP call runs no program of its own, but its server reads its `env:`.
  if (node.type === "mcp.call") {
    const { output: _output, ...program } = node;
    return [{ at: [], program }];
  }
  return [
    ...("before" in node && node.before !== undefined
      ? [{ at: ["before"], program: node.before }]
      : []),
    ...("verify" in node && node.verify !== undefined
      ? [{ at: ["verify"], program: node.verify }]
      : []),
  ];
};

/** The `before:` a leader or worker runs: its own, or the workflow's default. */
export const beforeOf = (
  node: Node,
  defaults: { before?: Step | undefined } | undefined,
): Step | undefined =>
  node.type === "claude.leader" || node.type === "claude.worker"
    ? (node.before ?? defaults?.before)
    : undefined;

/** Each program a node runs, with what it takes from the workflow's defaults. */
export const programsRunBy = (
  node: Node,
  defaults: { before?: Step | undefined } | undefined,
): { at: readonly string[]; program: Step }[] => {
  const inherited = beforeOf(node, defaults);
  return inherited !== undefined && !("before" in node && node.before)
    ? [{ at: ["before"], program: inherited }, ...programsOf(node)]
    : programsOf(node);
};
