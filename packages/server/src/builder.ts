/**
 * @file The workflow builder's files and drafts (RFC-008): what a workflow is
 *   while it's edited, applying edits to its draft, and saving it. This is the
 *   only place the server writes a project's files, and it writes only a valid
 *   workflow, inside the project's workflows folder.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  checkWorkflowText,
  nodeSays,
  placeFiles,
  type ProjectRecord,
  workflowDirOf,
} from "@krapht/ork-core";
import {
  applyEdits,
  newWorkflowText,
  type WorkflowEdit,
  WorkflowEditSchema,
} from "@krapht/ork-schema";

import {
  hashOfFile,
  outsideReason,
  readText,
  safeName,
  unreadableReason,
  writeWhole,
} from "./builder-files.ts";
import { draftGraph } from "./builder-graph.ts";
import type { ServerContext } from "./context.ts";
import type {
  BuilderEditAnswer,
  BuilderView,
  SaveAnswer,
} from "./contract-builder.ts";

const SUFFIX = ".ork.yaml";

export type Refused = { refused: 400 | 404 | 409; error: string };

const fileOf = (project: ProjectRecord, name: string): string =>
  path.join(placeFiles(project).workflows, `${name}${SUFFIX}`);

/** The workflow as it stands: its draft, or else its file. */
const viewOf = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  text: string,
): BuilderView => {
  const file = fileOf(project, name);
  const draft = context.store.draft(project.id, name);
  const onDisk = hashOfFile(file);
  const { diagnostics, workflow } = checkWorkflowText(text, {
    place: project,
    workflowDir: workflowDirOf(project, file),
    registered: context.store.projects(),
    home: context.home,
  });
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
    draft: draft !== undefined,
    baseHash: draft === undefined ? onDisk : draft.baseHash,
    changedOnDisk: draft !== undefined && onDisk !== draft.baseHash,
  };
};

const notFound = (project: ProjectRecord, name: string): Refused => ({
  refused: 404,
  error: `No workflow "${name}" in ${project.id}'s workflows.`,
});

const badName = (name: string): Refused => ({
  refused: 400,
  error: `"${name}" can't be a workflow's file name.`,
});

/** Why this workflow can't be touched at all, by its name or where it leads. */
const problemWith = (
  project: ProjectRecord,
  name: string,
): Refused | undefined => {
  if (!safeName(name)) return badName(name);
  const reason = unreadableReason(project, fileOf(project, name));
  return reason === undefined ? undefined : { refused: 409, error: reason };
};

/** What the builder shows for a workflow. */
export const builderView = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
): BuilderView | Refused => {
  const problem = problemWith(project, name);
  if (problem !== undefined) return problem;
  const text =
    context.store.draft(project.id, name)?.text ??
    readText(fileOf(project, name));
  return text === undefined
    ? notFound(project, name)
    : viewOf(context, project, name, text);
};

const NAME = /^[a-z0-9][a-z0-9._-]*$/u;

/** Starts a draft of a new workflow. */
export const createDraft = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
): BuilderView | Refused => {
  if (!NAME.test(name) || !safeName(name)) {
    return {
      refused: 400,
      error: "A workflow's name is a lowercase slug, such as nightly-review.",
    };
  }
  const problem = problemWith(project, name);
  if (problem !== undefined) return problem;
  if (
    existsSync(fileOf(project, name)) ||
    context.store.draft(project.id, name) !== undefined
  ) {
    return { refused: 409, error: `There is already a workflow "${name}".` };
  }
  const text = newWorkflowText(name);
  context.store.putDraft({
    project: project.id,
    workflow: name,
    text,
    baseHash: null,
    at: new Date().toISOString(),
  });
  return viewOf(context, project, name, text);
};

/**
 * Stores new text as the draft, or drops it if it's back to the file's. A draft
 * remembers the file it began from; `baseHash` says so when there's no draft
 * yet to remember it, and otherwise it's the file as it is now.
 */
const keep = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  text: string,
  baseHash?: string | null,
): void => {
  const file = fileOf(project, name);
  const draft = context.store.draft(project.id, name);
  if (text === readText(file)) {
    context.store.dropDraft(project.id, name);
    return;
  }
  context.store.putDraft({
    project: project.id,
    workflow: name,
    text,
    baseHash:
      draft === undefined
        ? baseHash === undefined
          ? hashOfFile(file)
          : baseHash
        : draft.baseHash,
    at: new Date().toISOString(),
  });
};

/** Applies edits to the draft, starting one from the file if there's none. */
export const editDraft = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  edits: readonly WorkflowEdit[],
): BuilderEditAnswer | Refused => {
  const problem = problemWith(project, name);
  if (problem !== undefined) return problem;
  const checked = WorkflowEditSchema.array().safeParse(edits);
  if (!checked.success) {
    return {
      refused: 400,
      error: checked.error.issues[0]?.message ?? "That isn't an edit.",
    };
  }
  const draft = context.store.draft(project.id, name);
  const file = fileOf(project, name);
  const text = draft?.text ?? readText(file);
  if (text === undefined) return notFound(project, name);
  const result = applyEdits(text, checked.data);
  if (!result.ok) return { refused: 409, error: result.message };
  const previous = {
    text,
    baseHash: draft === undefined ? hashOfFile(file) : draft.baseHash,
  };
  keep(context, project, name, result.text);
  return { ...viewOf(context, project, name, result.text), previous };
};

/** Puts a draft back to earlier text: the builder's undo. */
export const restoreDraft = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  text: string,
  baseHash: string | null,
): BuilderView | Refused => {
  const problem = problemWith(project, name);
  if (problem !== undefined) return problem;
  const known =
    context.store.draft(project.id, name) !== undefined ||
    existsSync(fileOf(project, name));
  if (!known) return notFound(project, name);
  keep(context, project, name, text, baseHash);
  return viewOf(context, project, name, text);
};

/** Throws away a draft; what's left is the file, if there is one. */
export const discardDraft = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
): BuilderView | { gone: true } | Refused => {
  if (!safeName(name)) return badName(name);
  context.store.dropDraft(project.id, name);
  const problem = problemWith(project, name);
  if (problem !== undefined) return problem;
  const text = readText(fileOf(project, name));
  return text === undefined
    ? { gone: true }
    : viewOf(context, project, name, text);
};

/**
 * Saves a draft to the workflows folder. Errors block it, as a running
 * workflow's call could read the file, and so does a file that changed since
 * the draft began, unless the user chooses to replace it.
 */
export const saveDraft = (
  context: ServerContext,
  project: ProjectRecord,
  name: string,
  force: boolean,
): SaveAnswer | Refused => {
  if (!safeName(name)) return badName(name);
  const file = fileOf(project, name);
  const outside = outsideReason(project, file);
  if (outside !== undefined) return { refused: 409, error: outside };
  const draft = context.store.draft(project.id, name);
  if (draft === undefined) {
    return existsSync(file) ? { saved: true, file } : notFound(project, name);
  }
  const { diagnostics } = checkWorkflowText(draft.text, {
    place: project,
    workflowDir: workflowDirOf(project, file),
    registered: context.store.projects(),
    home: context.home,
  });
  const errors = diagnostics.filter(d => d.severity === "error").length;
  if (errors > 0) {
    return {
      saved: false,
      why: "errors",
      message: `Fix ${errors === 1 ? "the error" : `the ${String(errors)} errors`} first; nothing was saved.`,
    };
  }
  if (!force && hashOfFile(file) !== draft.baseHash) {
    return {
      saved: false,
      why: "changed",
      message: `${path.basename(file)} changed since this draft began; nothing was saved.`,
    };
  }
  writeWhole(file, draft.text);
  context.store.dropDraft(project.id, name);
  return { saved: true, file };
};
