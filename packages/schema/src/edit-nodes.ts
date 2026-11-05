/**
 * @file Adding, removing and renaming a node in a YAML document (RFC-008). A
 *   rename follows every reference to the node, and a removal takes what can't
 *   stand without it; a template left reading a removed node is the checks' to
 *   report.
 */

import {
  type Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Pair,
  type Scalar,
  visit,
  type YAMLMap,
} from "yaml";

import { EditRefused, setAt } from "./edit-doc.ts";
import { dropFromEdges, edgeItems, renameInEdges } from "./edit-edges.ts";
import { renameInExpression, renameInTemplates } from "./edit-refs.ts";
import { changeScalar, deleteAt } from "./edit-remove.ts";
import { NodeIdSchema } from "./settings.ts";
import { WorkflowSchema } from "./workflow.ts";

const keyName = (pair: Pair): unknown =>
  isScalar(pair.key) ? pair.key.value : pair.key;

/** Each node's map, skipping aliases: a shared node is seen at its anchor. */
const nodeMaps = (doc: Document): { id: string; pair: Pair }[] => {
  const nodes = doc.get("nodes", true);
  if (!isMap(nodes)) return [];
  return nodes.items.map(pair => ({ id: String(keyName(pair)), pair }));
};

const refuseBadId = (id: string): void => {
  const checked = NodeIdSchema.safeParse(id);
  if (!checked.success) {
    throw new EditRefused(
      checked.error.issues[0]?.message ?? `\`${id}\` can't be a node id.`,
    );
  }
};

const refuseTaken = (doc: Document, id: string): void => {
  if (nodeMaps(doc).some(node => node.id === id)) {
    throw new EditRefused(`There is already a node named ${id}.`);
  }
};

const refuseMissing = (doc: Document, id: string): void => {
  if (!nodeMaps(doc).some(node => node.id === id)) {
    throw new EditRefused(`There is no node named ${id}.`);
  }
};

/** Adds a node at the end of `nodes`. */
export const addNode = (
  doc: Document,
  id: string,
  node: Readonly<Record<string, unknown>>,
): void => {
  refuseBadId(id);
  refuseTaken(doc, id);
  setAt(doc, ["nodes", id], node, WorkflowSchema);
};

const channels = (doc: Document) => {
  const messages = doc.get("messages", true);
  return isSeq(messages) ? messages : undefined;
};

/** The ids a channel's `between` holds, as their scalars. */
const betweenOf = (item: unknown): Scalar[] => {
  if (!isMap(item)) return [];
  const between = item.get("between", true);
  return isSeq(between) ? between.items.filter(isScalar) : [];
};

/** The comments at the very end of a value, wherever the library hung them. */
const trailingComments = (value: unknown): string[] => {
  if (!isMap(value) && !isSeq(value)) return [];
  const last = value.items.at(-1);
  const inner = isPair(last) ? last.value : last;
  return [
    ...trailingComments(inner),
    ...(typeof value.comment === "string" ? [value.comment] : []),
  ];
};

/**
 * A comment above a node can be held by the node before it, so it goes to the
 * next node rather than out with this one. There's no telling which node a
 * comment there was about, and one kept too many costs less than one lost.
 */
const passOnComments = (nodes: YAMLMap, id: string): void => {
  const at = nodes.items.findIndex(pair => keyName(pair) === id);
  const comments = trailingComments(nodes.items[at]?.value);
  const next = nodes.items[at + 1];
  if (comments.length === 0 || !isScalar(next?.key)) return;
  next.key.commentBefore = [...comments, next.key.commentBefore ?? []]
    .flat()
    .join("\n");
};

/** Removes a node, its edges and its channels, and frees what it owned. */
export const removeNode = (doc: Document, id: string): void => {
  refuseMissing(doc, id);
  const nodes = doc.get("nodes", true);
  // A comment above the first node belongs to the map, and would pass to the
  // next node if it stayed.
  const first = isMap(nodes) ? nodes.items[0] : undefined;
  if (isMap(nodes) && first !== undefined && keyName(first) === id) {
    nodes.commentBefore = null;
  }
  if (isMap(nodes)) passOnComments(nodes, id);
  deleteAt(doc, ["nodes", id]);
  dropFromEdges(doc, id);
  const messages = channels(doc);
  if (messages !== undefined) {
    messages.items = messages.items.filter(
      item => !betweenOf(item).some(scalar => scalar.value === id),
    );
    if (messages.items.length === 0) deleteAt(doc, ["messages"]);
  }
  for (const node of nodeMaps(doc)) {
    if (isMap(node.pair.value) && node.pair.value.get("parent") === id) {
      deleteAt(doc, ["nodes", node.id, "parent"]);
    }
  }
};

/** A field that holds exactly a node's id. */
const followId = (
  doc: Document,
  node: unknown,
  from: string,
  to: string,
  path: readonly (string | number)[],
): void => {
  changeScalar(doc, node, text => (text === from ? to : text), path);
};

/** Follows the new id through every template in the file. */
const renameInStrings = (doc: Document, from: string, to: string): void => {
  visit(doc, {
    Scalar: (key, scalar) => {
      if (key !== "key" && typeof scalar.value === "string") {
        const next = renameInTemplates(scalar.value, from, to);
        if (next !== scalar.value) {
          scalar.value = next;
          delete scalar.source;
        }
      }
    },
  });
};

/** A `when:` is an expression; elsewhere that word is only a word. */
const followWhen = (
  doc: Document,
  owner: unknown,
  from: string,
  to: string,
  path: readonly (string | number)[],
): void => {
  if (!isMap(owner)) return;
  changeScalar(
    doc,
    owner.get("when", true),
    text => renameInExpression(text, from, to),
    [...path, "when"],
  );
};

/** Follows the new id through a node's `parent` and `notify:` rules. */
const renameInNode = (
  doc: Document,
  id: string,
  value: unknown,
  from: string,
  to: string,
): void => {
  if (!isMap(value)) return;
  const path = ["nodes", id];
  followId(doc, value.get("parent", true), from, to, [...path, "parent"]);
  const notify = value.get("notify", true);
  if (!isSeq(notify)) return;
  for (const [index, rule] of notify.items.entries()) {
    const at = [...path, "notify", index];
    if (isMap(rule))
      followId(doc, rule.get("to", true), from, to, [...at, "to"]);
    followWhen(doc, rule, from, to, at);
  }
};

/**
 * Renames a node, following every reference to it in this file. A call from
 * another workflow names it too, and is that file's to change.
 */
export const renameNode = (doc: Document, from: string, to: string): void => {
  if (from === to) return;
  refuseBadId(to);
  refuseMissing(doc, from);
  refuseTaken(doc, to);
  for (const node of nodeMaps(doc)) {
    renameInNode(doc, node.id, node.pair.value, from, to);
    if (node.id === from && isScalar(node.pair.key)) {
      node.pair.key.value = to;
      delete node.pair.key.source;
    }
  }
  for (const [index, item] of (channels(doc)?.items ?? []).entries()) {
    const between = isMap(item) ? item.get("between", true) : undefined;
    for (const scalar of isSeq(between) ? between.items : []) {
      followId(doc, scalar, from, to, ["messages", index, "between"]);
    }
  }
  renameInEdges(doc, from, to);
  for (const [index, item] of edgeItems(doc).entries()) {
    followWhen(doc, item, from, to, ["edges", index]);
  }
  renameInStrings(doc, from, to);
};
