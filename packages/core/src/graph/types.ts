/** @file The compiled run graph's types, and the fields each node type reports. */

import {
  type Diagnostic,
  type Edge,
  isToolNode,
  type Node,
  type NodeType,
  type Workflow,
} from "@krapht/ork-schema";

import type { AgentRef } from "../agents/apply.ts";
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
  /** Node id → the agent that filled it. */
  agents: Map<string, AgentRef>;
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
export const OUTPUT_FIELDS: Record<
  Exclude<NodeType, `tool.${string}`>,
  readonly string[] | null
> = {
  "claude.leader": [
    "status",
    "summary",
    "artifacts",
    "branch",
    "worktree",
    "usage",
  ],
  "claude.worker": [
    "status",
    "summary",
    "artifacts",
    "branch",
    "worktree",
    "usage",
  ],
  "claude.subagent": ["status", "summary", "artifacts"],
  "control.split": null,
  "control.join": ["statuses", "results", "count"],
  "control.router": null,
  "human.gate": ["choice", "answeredBy"],
};

/** What every tool node reports, whichever integration it uses. */
export const TOOL_OUTPUT_FIELDS = ["exitCode", "stdout", "stderr"] as const;

/** Report statuses a Claude node may end with. */
export const REPORT_STATUSES = [
  "pass",
  "changes_requested",
  "fail",
  "done",
] as const;

export const outputFieldsOf = (node: Node): readonly string[] | null => {
  if (isToolNode(node)) return TOOL_OUTPUT_FIELDS;
  const base = OUTPUT_FIELDS[node.type];
  if (base === null) return null;
  if ("output" in node && node.output?.schema !== undefined) {
    return [...base, ...Object.keys(node.output.schema)];
  }
  return base;
};
