/**
 * @file A workflow as the graph the UI draws: its nodes, its edges with their
 *   shorthand expanded, its channels, and the positions in its `.layout.json`.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  expandEdge,
  layoutFileOf,
  parseLayoutFile,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

export type WorkflowGraph = {
  nodes: { id: string; type: string; parent?: string | undefined }[];
  edges: {
    from: string;
    to: string;
    when?: string | undefined;
    maxRounds?: number | undefined;
  }[];
  channels: (readonly [string, string])[];
  positions: Record<string, { x: number; y: number }>;
};

export const workflowGraph = (
  workflow: Workflow,
  positions: WorkflowGraph["positions"] = {},
): WorkflowGraph => ({
  nodes: Object.entries(workflow.nodes).map(([id, node]) => ({
    id,
    type: node.type,
    parent: node.parent,
  })),
  edges: (workflow.edges ?? []).flatMap((input, index) => {
    const expanded = expandEdge(input, index);
    return expanded.ok
      ? expanded.edges.map(({ from, to, when, maxRounds }) => ({
          from,
          to,
          when,
          maxRounds,
        }))
      : [];
  }),
  channels: (workflow.messages ?? []).map(
    ({ between: [a, b] }) => [a, b] as const,
  ),
  positions,
});

/** The graph of a workflow file, or `null` if it is gone or does not parse. */
export const readWorkflowGraph = (file: string): WorkflowGraph | null => {
  if (!existsSync(file)) return null;
  const parsed = parseWorkflow(readFileSync(file, "utf8"));
  if (!parsed.ok) return null;
  const sidecar = layoutFileOf(file);
  return workflowGraph(
    parsed.workflow,
    existsSync(sidecar) ? parseLayoutFile(readFileSync(sidecar, "utf8")) : {},
  );
};
