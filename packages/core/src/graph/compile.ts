/**
 * @file The graph compiler's entry point: puts the project's rules under the
 *   workflow, fills agent nodes from their agents, runs every check and, when
 *   there is no error, builds the run graph the scheduler executes.
 */

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

import { type ApplyOptions, applyAgents } from "../agents/apply.ts";
import { checkMcpServers, type McpOptions } from "../project/mcp-file.ts";
import {
  applyProject,
  checkRules,
  type ProjectOptions,
} from "../project/rules.ts";
import { checkFlow } from "./checks.ts";
import { checkReach, compileEdges, findEntries } from "./flow.ts";
import { checkChannels } from "./nodes.ts";
import { compileRules } from "./notify.ts";
import { checkOwnership } from "./tree.ts";
import type { CompiledGraph, CompiledNode, CompileResult } from "./types.ts";

export type { CompiledGraph };

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/**
 * Compiles a structurally valid workflow into an executable graph and checks
 * everything the schema cannot: the agents its nodes name, the ownership tree,
 * edges, bounded cycles, the shape of loops, references in templates and
 * conditions, the values conditions compare, and per-type rules. The project's
 * rules go under the workflow and agent nodes are filled from their agents
 * first, so every check sees the effective node; the graph holds that effective
 * workflow.
 */
export const compileWorkflow = (
  authored: Workflow,
  options: ApplyOptions & ProjectOptions & McpOptions = {},
): CompileResult => {
  const applied = applyAgents(applyProject(authored, options), options);
  const { workflow } = applied;
  const flow = compileEdges(workflow);
  const { edges } = flow;
  const entries = findEntries(workflow, edges);
  const channels = checkChannels(workflow);
  const rules = compileRules(workflow);

  const diagnostics: Diagnostic[] = [
    ...applied.diagnostics,
    ...checkOwnership(workflow),
    ...flow.diagnostics,
    ...checkFlow(workflow, edges, rules.rules),
    ...rules.diagnostics,
    ...channels.diagnostics,
    ...checkRules(workflow),
    ...checkMcpServers(workflow, options),
    ...checkReach(workflow, edges, entries),
  ];

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
    rules: rules.rules,
  };
  return { graph, diagnostics };
};
