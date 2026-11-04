/**
 * @file The edits the workflow builder makes (RFC-008): each takes a workflow's
 *   text and gives its new text, and only the lines it had to change differ, so
 *   comments, style and unknown fields stay. It works on unfinished workflows
 *   as well, since a draft passes through states the compiler would refuse.
 */

import { parseDocument } from "yaml";
import { z } from "zod";

import { EditRefused, setAt } from "./edit-doc.ts";
import { connect, disconnect, setEdge } from "./edit-edges.ts";
import { keepingUntouchedLines, styleOf } from "./edit-lines.ts";
import { addNode, removeNode, renameNode } from "./edit-nodes.ts";
import { sameValue } from "./edit-order.ts";
import { deleteAt, refuseLostAnchors } from "./edit-remove.ts";
import { SCHEMA_VERSION, WorkflowSchema } from "./workflow.ts";
import { serializeWorkflow } from "./yaml.ts";

const PathSchema = z
  .array(z.union([z.string(), z.number().int().min(0)]))
  .min(1);
const EdgeOptionFields = {
  when: z.string().optional(),
  maxRounds: z.number().int().positive().optional(),
};
/** Which edge this is, when two link the same nodes on different conditions. */
const WhichEdge = { whenWas: z.string().optional() };

/** One edit: what the UI sends and the server applies. */
export const WorkflowEditSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set"),
    path: PathSchema,
    value: z.unknown(),
  }),
  z.strictObject({ op: z.literal("delete"), path: PathSchema }),
  z.strictObject({
    op: z.literal("addNode"),
    id: z.string(),
    node: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ op: z.literal("removeNode"), id: z.string() }),
  z.strictObject({
    op: z.literal("renameNode"),
    from: z.string(),
    to: z.string(),
  }),
  z.strictObject({
    op: z.literal("connect"),
    from: z.string(),
    to: z.string(),
    ...EdgeOptionFields,
  }),
  z.strictObject({
    op: z.literal("disconnect"),
    from: z.string(),
    to: z.string(),
    ...WhichEdge,
  }),
  z.strictObject({
    op: z.literal("setEdge"),
    from: z.string(),
    to: z.string(),
    ...EdgeOptionFields,
    ...WhichEdge,
  }),
]);
export type WorkflowEdit = z.infer<typeof WorkflowEditSchema>;

export type EditResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

const optionsOf = (edit: {
  when?: string | undefined;
  maxRounds?: number | undefined;
}) => ({
  ...(edit.when === undefined ? {} : { when: edit.when }),
  ...(edit.maxRounds === undefined ? {} : { maxRounds: edit.maxRounds }),
});

/** Applies edits in order: all of them, or none if one is refused. */
export const applyEdits = (
  text: string,
  edits: readonly WorkflowEdit[],
): EditResult => {
  const doc = parseDocument(text, { prettyErrors: false });
  const [syntax] = doc.errors;
  if (syntax !== undefined) {
    return {
      ok: false,
      message: `The file doesn't parse: ${syntax.message.split("\n")[0] ?? syntax.message}`,
    };
  }
  try {
    const style = styleOf(text);
    const before: unknown = doc.toJS();
    const printed = doc.toString(style);
    for (const edit of edits) perform(doc, edit);
    refuseLostAnchors(doc);
    return {
      ok: true,
      // An edit that changes nothing doesn't tidy the file either.
      text: sameValue(before, doc.toJS())
        ? text
        : keepingUntouchedLines(text, printed, doc.toString(style)),
    };
  } catch (error) {
    if (error instanceof EditRefused) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
};

/** A field of a node that isn't there: the edit is about something gone. */
const refuseMissingNode = (
  doc: Parameters<typeof setAt>[0],
  path: readonly (string | number)[],
): void => {
  const [root, id] = path;
  if (
    root === "nodes" &&
    id !== undefined &&
    path.length > 2 &&
    !doc.hasIn(["nodes", id])
  ) {
    throw new EditRefused(`There is no node named ${String(id)}.`);
  }
};

const perform = (
  doc: Parameters<typeof setAt>[0],
  edit: WorkflowEdit,
): void => {
  switch (edit.op) {
    case "set":
      refuseMissingNode(doc, edit.path);
      setAt(doc, edit.path, edit.value, WorkflowSchema);
      return;
    case "delete":
      deleteAt(doc, edit.path);
      return;
    case "addNode":
      addNode(doc, edit.id, edit.node);
      return;
    case "removeNode":
      removeNode(doc, edit.id);
      return;
    case "renameNode":
      renameNode(doc, edit.from, edit.to);
      return;
    case "connect":
      connect(doc, edit.from, edit.to, optionsOf(edit));
      return;
    case "disconnect":
      disconnect(doc, edit.from, edit.to, edit.whenWas);
      return;
    case "setEdge":
      setEdge(doc, edit.from, edit.to, optionsOf(edit), edit.whenWas);
      return;
    default:
      edit satisfies never;
  }
};

/**
 * What a workflow's text says, valid or not, for a draft the compiler would
 * refuse; `undefined` if it isn't YAML.
 */
export const readDocument = (text: string): unknown => {
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) return undefined;
  try {
    return doc.toJS() as unknown;
  } catch {
    return undefined;
  }
};

/** The text a workflow starts from, canonical with no nodes yet. */
export const newWorkflowText = (name: string): string =>
  serializeWorkflow({ schemaVersion: SCHEMA_VERSION, name, nodes: {} });
