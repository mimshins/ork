/**
 * @file The checks on a workflow's text: the format, then the compiler with the
 *   project's rules and agents, its call targets, and its skill and context
 *   references. `ork validate`, `ork run` and the workflow builder all use
 *   this, so they can't disagree (RFC-008).
 */

import {
  type Diagnostic,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

import { loadAgents } from "../agents/catalog.ts";
import { contextDiagnostics } from "../context/resolve.ts";
import { compileWorkflow } from "../graph/compile.ts";
import type { CompiledGraph } from "../graph/types.ts";
import { checkCallTargets } from "./calls.ts";
import { placeFiles, type ProjectPlace } from "./place.ts";
import { loadProject } from "./rules.ts";

export type WorkflowChecks = {
  diagnostics: Diagnostic[];
  /** The effective workflow, or `null` when it has errors. */
  workflow: Workflow | null;
  /** The compiled graph, or `null` when it has errors. */
  graph: CompiledGraph | null;
  /** What compiled, errors or not. */
  summary?: { nodes: number; edges: number; entries: string[] };
};

export type CheckWhere = {
  /** The project the workflow belongs to. */
  place: ProjectPlace;
  /** Where its relative paths resolve from. */
  workflowDir: string;
  /** The registered projects, for call targets. */
  registered: readonly ProjectPlace[];
  /** The user's `~`; tests pass a folder. */
  home?: string | undefined;
};

/** Every check on a workflow's text, with each diagnostic's line and column. */
export const checkWorkflowText = (
  text: string,
  { place, workflowDir, registered, home }: CheckWhere,
): WorkflowChecks => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) {
    return { diagnostics: parsed.diagnostics, workflow: null, graph: null };
  }
  const projectRoot = place.root;
  const catalog = loadAgents({
    projectRoot,
    orkDir: place.dir,
    ...(home === undefined ? {} : { home }),
  });
  const loaded = loadProject(projectRoot, placeFiles(place).rules);
  const compiled = compileWorkflow(parsed.workflow, {
    catalog,
    workflowDir,
    projectRoot,
    ...(loaded.project === undefined ? {} : { project: loaded.project }),
  });
  const { graph } = compiled;
  const diagnostics: Diagnostic[] = [];
  for (const diagnostic of [
    ...loaded.diagnostics,
    ...compiled.diagnostics,
    ...checkCallTargets(parsed.workflow, place, registered),
    ...(graph === null
      ? []
      : contextDiagnostics(graph.workflow, { workflowDir, projectRoot })),
  ]) {
    const position = parsed.locate(diagnostic.path);
    diagnostics.push(
      position === null ? diagnostic : { ...diagnostic, ...position },
    );
  }
  if (graph === null) return { diagnostics, workflow: null, graph: null };
  const clean = !diagnostics.some(d => d.severity === "error");
  return {
    diagnostics,
    workflow: clean ? graph.workflow : null,
    graph: clean ? graph : null,
    summary: {
      nodes: graph.nodes.size,
      edges: graph.edges.length,
      entries: graph.entries,
    },
  };
};
