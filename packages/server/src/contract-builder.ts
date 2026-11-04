/**
 * @file The workflow builder's part of the API's contract (RFC-008): its
 *   routes, their bodies and what they answer. Like the rest of the contract it
 *   imports only `zod` and types, so a browser bundle can use it.
 */

import type { Diagnostic, WorkflowEdit } from "@krapht/ork-schema";
import { z } from "zod";

import type { WorkflowGraph } from "./contract.ts";

export type { Diagnostic, WorkflowEdit };

/** A new workflow's name, as its file and its `name:` take it. */
export const NewWorkflowSchema = z.strictObject({ name: z.string().min(1) });

/** The server checks each edit; this file imports only types of the schema. */
export const WorkflowEditsSchema = z.strictObject({
  edits: z.array(z.custom<WorkflowEdit>()).min(1),
});

/** Earlier text, and the file it was based on, to ask before replacing it. */
export const DraftTextSchema = z.strictObject({
  text: z.string(),
  baseHash: z.string().nullable(),
});

export const SaveWorkflowSchema = z.strictObject({
  /** Write over a file that changed since this draft began. */
  force: z.boolean().optional(),
});

/** A workflow as the builder edits it: its draft, or else its file. */
export type BuilderView = {
  name: string;
  /** Where Save writes. */
  file: string;
  text: string;
  /** What the text says, valid or not; `null` if it isn't YAML. */
  document: unknown;
  /** The nodes and edges to draw. */
  graph: WorkflowGraph;
  diagnostics: Diagnostic[];
  /** Whether there's anything unsaved. */
  draft: boolean;
  /** The file this text began from, by hash; `null` if there was no file. */
  baseHash: string | null;
  /** The file changed, or appeared, after this draft began. */
  changedOnDisk: boolean;
};

/** An edit's answer, with what it was applied to: one step back for undo. */
export type BuilderEditAnswer = BuilderView & {
  previous: { text: string; baseHash: string | null };
};

/** What a builder's pickers offer in a project. */
export type BuilderCatalog = {
  agents: { name: string; description: string; source: string }[];
  skills: { name: string; layer: string }[];
};

export type SaveAnswer =
  | { saved: true; file: string }
  | { saved: false; why: "errors" | "changed"; message: string };

export const BUILDER_API = {
  builderSchema: { method: "GET", path: "/api/workflow-schema" },
  builderCatalog: { method: "GET", path: "/api/projects/:id/catalog" },
  builderDrafts: { method: "GET", path: "/api/projects/:id/builder" },
  builderView: { method: "GET", path: "/api/projects/:id/builder/:name" },
  builderCreate: {
    method: "POST",
    path: "/api/projects/:id/builder",
    body: NewWorkflowSchema,
  },
  builderEdit: {
    method: "POST",
    path: "/api/projects/:id/builder/:name/edits",
    body: WorkflowEditsSchema,
  },
  builderRestore: {
    method: "POST",
    path: "/api/projects/:id/builder/:name/text",
    body: DraftTextSchema,
  },
  builderDiscard: {
    method: "POST",
    path: "/api/projects/:id/builder/:name/discard",
  },
  builderSave: {
    method: "POST",
    path: "/api/projects/:id/builder/:name/save",
    body: SaveWorkflowSchema,
  },
} as const;

/** What each builder route answers with, on success. */
export type BuilderResponses = {
  builderSchema: unknown;
  builderCatalog: BuilderCatalog;
  builderDrafts: string[];
  builderView: BuilderView;
  builderCreate: BuilderView;
  builderEdit: BuilderEditAnswer;
  builderRestore: BuilderView;
  builderDiscard: BuilderView | { gone: true };
  builderSave: SaveAnswer;
};
