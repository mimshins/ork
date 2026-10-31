/**
 * @file The graph compiler's entry point: fills agent nodes from their agents,
 *   runs every check and, when there is no error, builds the run graph the
 *   scheduler executes.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { type ApplyOptions, applyAgents } from "../agents/apply.ts";
import { error, warning } from "./diagnostics.ts";
import {
  checkCycles,
  compileEdges,
  findEntries,
  findUnreachable,
} from "./flow.ts";
import { checkChannels, checkNodes } from "./nodes.ts";
import { checkReferences } from "./refs.ts";
import { checkOwnership } from "./tree.ts";
import type { CompiledGraph, CompiledNode, CompileResult } from "./types.ts";

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/**
 * Compiles a structurally valid workflow into an executable graph and checks
 * everything the schema cannot: the agents its nodes name, the ownership tree,
 * edges, bounded cycles, references in templates and conditions, and per-type
 * rules. Agent nodes are filled from their agents first, so every check sees
 * the effective node; the graph holds that effective workflow.
 */
export const compileWorkflow = (
  authored: Workflow,
  options: ApplyOptions = {},
): CompileResult => {
  const applied = applyAgents(authored, options);
  const { workflow } = applied;
  const flow = compileEdges(workflow);
  const { edges } = flow;
  const entries = findEntries(workflow, edges);
  const channels = checkChannels(workflow);

  const diagnostics: Diagnostic[] = [
    ...applied.diagnostics,
    ...checkOwnership(workflow),
    ...flow.diagnostics,
    ...checkCycles(workflow, edges),
    ...checkNodes(workflow, edges),
    ...checkReferences(workflow, edges),
    ...channels.diagnostics,
  ];

  if (entries.length === 0) {
    diagnostics.push(
      error(
        "graph.no-entry",
        "no node can start: every unowned node has an incoming edge",
        ["edges"],
      ),
    );
  }
  // With no entry everything is unreachable; the error above says enough.
  const unreachable =
    entries.length === 0 ? [] : findUnreachable(workflow, edges, entries);
  for (const id of unreachable) {
    diagnostics.push(
      warning(
        "graph.unreachable",
        `"${id}" never runs: no entry reaches it through edges or ownership`,
        ["nodes", id],
      ),
    );
  }

  diagnostics.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  if (diagnostics.some(d => d.severity === "error")) {
    return { graph: null, diagnostics };
  }

  const nodes = new Map<string, CompiledNode>();
  for (const [id, node] of Object.entries(workflow.nodes)) {
    nodes.set(id, {
      id,
      node,
      children: Object.entries(workflow.nodes)
        .filter(([, child]) => child.parent === id)
        .map(([childId]) => childId),
      incoming: edges.filter(e => e.to === id),
      outgoing: edges.filter(e => e.from === id),
    });
  }
  const graph: CompiledGraph = {
    workflow,
    nodes,
    edges,
    entries,
    channels: channels.channels,
    agents: applied.agents,
  };
  return { graph, diagnostics };
};
