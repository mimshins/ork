/**
 * @file The graph of a draft (RFC-008). A draft isn't valid until it's
 *   finished, so this reads what the text says rather than the parsed workflow:
 *   a node with no type yet still gets a card, and an edge that can't be read
 *   is left for the checks to report.
 */

import {
  applyEdits,
  EdgeInputSchema,
  expandEdge,
  newWorkflowText,
  parseWorkflow,
  readDocument,
} from "@krapht/ork-schema";

import type { WorkflowGraph } from "./contract.ts";

/** What a client's tests need to play the server's builder routes. */
export { applyEdits, newWorkflowText, parseWorkflow };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const EMPTY: WorkflowGraph = {
  nodes: [],
  edges: [],
  channels: [],
};

/** What the text says, and the graph to draw from it. */
export const draftGraph = (
  text: string,
): { document: unknown; graph: WorkflowGraph } => {
  const document = readDocument(text);
  if (!isRecord(document)) {
    return { document: document ?? null, graph: EMPTY };
  }
  const nodes = isRecord(document["nodes"])
    ? Object.entries(document["nodes"]).map(([id, node]) => ({
        id,
        type:
          isRecord(node) && typeof node["type"] === "string"
            ? node["type"]
            : "",
        parent:
          isRecord(node) && typeof node["parent"] === "string"
            ? node["parent"]
            : undefined,
      }))
    : [];
  const edges = asArray(document["edges"]).flatMap((input, index) => {
    const parsed = EdgeInputSchema.safeParse(input);
    if (!parsed.success) return [];
    const expanded = expandEdge(parsed.data, index);
    return expanded.ok
      ? expanded.edges.map(({ from, to, when, maxRounds }) => ({
          from,
          to,
          when,
          maxRounds,
        }))
      : [];
  });
  const channels = asArray(document["messages"]).flatMap(channel => {
    const between = isRecord(channel) ? asArray(channel["between"]) : [];
    const [a, b] = between;
    return typeof a === "string" && typeof b === "string"
      ? [[a, b] as const]
      : [];
  });
  return { document, graph: { nodes, edges, channels } };
};
