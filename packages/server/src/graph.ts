/**
 * @file A workflow or a run as the graph the UI draws: its nodes, its edges
 *   with their shorthand expanded, and its channels. Where they sit follows
 *   from those, so nothing about that is stored (RFC-008).
 */

import { existsSync, readFileSync } from "node:fs";

import type { RunEvent } from "@krapht/ork-core";
import { expandEdge, parseWorkflow, type Workflow } from "@krapht/ork-schema";

import type { WorkflowGraph } from "./contract.ts";

export const workflowGraph = (workflow: Workflow): WorkflowGraph => ({
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
});

/** The graph of a workflow file, or `null` if it is gone or does not parse. */
export const readWorkflowGraph = (file: string): WorkflowGraph | null => {
  if (!existsSync(file)) return null;
  const parsed = parseWorkflow(readFileSync(file, "utf8"));
  if (!parsed.ok) return null;
  return workflowGraph(parsed.workflow);
};

/**
 * The graph of a run: what it recorded it ran, so editing the file later does
 * not redraw it. A run from before edges were kept has only its file to go by.
 */
export const runGraph = (
  events: readonly RunEvent[],
  file: string,
): WorkflowGraph => {
  const started = events.findLast(event => event.type === "run.started");
  const onFile = readWorkflowGraph(file);
  const nodes = started?.type === "run.started" ? started.nodes : [];
  const edges = started?.type === "run.started" ? started.edges : undefined;
  const channels =
    started?.type === "run.started" ? started.channels : undefined;
  return {
    nodes:
      nodes.length === 0
        ? (onFile?.nodes ?? [])
        : nodes.map(({ id, type, parent }) => ({ id, type, parent })),
    edges: edges ?? onFile?.edges ?? [],
    channels: channels ?? onFile?.channels ?? [],
  };
};
