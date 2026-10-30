/** @file The compiled run graph's types, and the fields each node type reports. */

import type {
  Diagnostic,
  Edge,
  Node,
  NodeType,
  Workflow,
} from "@krapht/ork-schema";

import type { Expr } from "../expr/parse.ts";

export type CompiledEdge = Edge & { condition?: Expr };

export type CompiledNode = {
  id: string;
  node: Node;
  /** Direct children in the ownership tree. */
  children: string[];
  incoming: CompiledEdge[];
  outgoing: CompiledEdge[];
};

export type CompiledGraph = {
  workflow: Workflow;
  nodes: Map<string, CompiledNode>;
  edges: CompiledEdge[];
  /** Nodes that start when the run starts: no incoming edge and no owner. */
  entries: string[];
  /** Declared sibling channels; parent <-> child is always allowed. */
  channels: [string, string][];
};

export type CompileResult = {
  /** `null` when there is at least one error. */
  graph: CompiledGraph | null;
  diagnostics: Diagnostic[];
};

/**
 * Fields every node of a type reports, readable as `nodes.<id>.output.<field>`
 * and as bare names in the `when:` of its outgoing edges. `null` means the type
 * passes its input through, so any field may exist.
 */
export const OUTPUT_FIELDS: Record<NodeType, readonly string[] | null> = {
  "claude.leader": ["status", "summary", "artifacts", "branch", "usage"],
  "claude.worker": ["status", "summary", "artifacts", "branch", "usage"],
  "claude.subagent": ["status", "summary", "artifacts"],
  "tool.gh": ["exitCode", "stdout", "stderr"],
  "tool.aws": ["exitCode", "stdout", "stderr"],
  "tool.shell": ["exitCode", "stdout", "stderr"],
  "control.split": null,
  "control.join": ["statuses", "results", "count"],
  "control.router": null,
  "human.gate": ["choice", "answeredBy"],
};

/** Report statuses a Claude node may end with. */
export const REPORT_STATUSES = [
  "pass",
  "changes_requested",
  "fail",
  "done",
] as const;

export const outputFieldsOf = (node: Node): readonly string[] | null => {
  const base = OUTPUT_FIELDS[node.type];
  if (base === null) return null;
  if ("output" in node && node.output?.schema !== undefined) {
    return [...base, ...Object.keys(node.output.schema)];
  }
  return base;
};
