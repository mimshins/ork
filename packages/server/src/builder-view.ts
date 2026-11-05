/**
 * @file What the builder shows for a workflow's text (RFC-008): what it says,
 *   its graph, what the checks say, and what walking it found (RFC-009), which
 *   never stops a save.
 */

import path from "node:path";

import {
  checkWorkflowText,
  nodeSays,
  placeFiles,
  type ProjectRecord,
  walkChecks,
  walkSummary,
  workflowDirOf,
} from "@krapht/ork-core";

import { hashOfFile } from "./builder-files.ts";
import { draftGraph } from "./builder-graph.ts";
import type { ServerContext } from "./context.ts";
import type { BuilderView } from "./contract-builder.ts";

const SUFFIX = ".ork.yaml";

/**
 * How long a walk may hold up an edit, which waits for it and which the next
 * edit waits behind. A walk that stops says so, and claims nothing.
 */
export const EDIT_WALK_MS = 200;

export const fileOf = (project: ProjectRecord, name: string): string =>
  path.join(placeFiles(project).workflows, `${name}${SUFFIX}`);

/** The workflow as it stands: its draft, or else its file. */
export const viewOf = async (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  text: string,
): Promise<BuilderView> => {
  const file = fileOf(project, name);
  const draft = context.store.draft(project.id, name);
  const onDisk = hashOfFile(file);
  const { diagnostics, workflow, walk } = await walkChecks(
    checkWorkflowText(text, {
      place: project,
      workflowDir: workflowDirOf(project, file),
      registered: context.store.projects(),
      home: context.home,
    }),
    { maxMs: EDIT_WALK_MS },
  );
  const graph = draftGraph(text);
  return {
    name,
    file,
    text,
    document: graph.document,
    // With an agent's settings in, where it's valid enough to have them.
    graph:
      workflow === null
        ? graph.graph
        : {
            ...graph.graph,
            says: nodeSays(workflow.nodes, graph.graph.edges),
          },
    diagnostics,
    walk: walk === undefined ? null : walkSummary(walk),
    draft: draft !== undefined,
    baseHash: draft === undefined ? onDisk : draft.baseHash,
    changedOnDisk: draft !== undefined && onDisk !== draft.baseHash,
  };
};
