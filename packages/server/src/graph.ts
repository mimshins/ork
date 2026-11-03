/**
 * @file A workflow or a run as the graph the UI draws: its nodes, its edges
 *   with their shorthand expanded, its channels, and the positions in its
 *   `.layout.json`.
 */

import { existsSync, readFileSync } from "node:fs";

import type { RunEvent } from "@krapht/ork-core";
import {
  expandEdge,
  layoutFileOf,
  parseLayoutFile,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

import type { WorkflowGraph } from "./contract.ts";

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

/**
 * The graph of a run: what it recorded it ran, so editing the file later does
 * not redraw it. A run from before edges were kept has only its file to go by.
 * Cards sit where the file's `.layout.json` puts them now.
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
    positions: onFile?.positions ?? {},
  };
};
