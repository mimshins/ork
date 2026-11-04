/**
 * @file Keeping conditions in step with the values they read (RFC-010). A list
 *   of values, a gate's options or a declared output field's, can change under
 *   the conditions reading it: renaming one follows into them, and removing one
 *   that's read is refused, as it would leave an edge that's never followed.
 */

import { type Document, isMap, isNode } from "yaml";

import { EditRefused } from "./edit-doc.ts";
import { edgeItems, entryOf } from "./edit-edge-entry.ts";
import { changeScalar } from "./edit-remove.ts";

type EditPath = readonly (string | number)[];

/** The list this path is in, and the field a condition reads it by. */
const listAt = (
  path: EditPath,
): { id: string; at: EditPath; field: string } | undefined => {
  const [root, id, key, schema, name] = path;
  if (root !== "nodes" || typeof id !== "string") return undefined;
  if (key === "options") {
    return { id, at: ["nodes", id, "options"], field: "choice" };
  }
  if (key !== "output" || schema !== "schema" || typeof name !== "string") {
    return undefined;
  }
  return {
    id,
    at: ["nodes", id, "output", "schema", name],
    field: name,
  };
};

const fieldNames = (doc: Document, id: string, field: string): string[] =>
  String(doc.getIn(["nodes", id, "type"])).startsWith("claude.")
    ? [field]
    : [`json.${field}`, field];

const asValues = (raw: unknown): unknown[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) =>
    typeof item === "object" && item !== null && "id" in item ? item.id : item,
  );
};

const valuesAt = (doc: Document, at: EditPath): unknown[] => {
  const node = doc.getIn(at, true);
  return asValues(isNode(node) ? node.toJS(doc) : node);
};

const literalOf = (value: unknown): string =>
  typeof value === "string"
    ? `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
    : String(value);

/** Each quoted string or bare value in `when` that equals `value`, replaced. */
const replaceValue = (
  when: string,
  value: unknown,
  next: (quote: string) => string,
): string => {
  const text = String(value);
  const escaped = text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const pattern =
    typeof value === "string"
      ? new RegExp(String.raw`(['"])${escaped}\1`, "gu")
      : new RegExp(String.raw`(?<![\w.'"-])${escaped}(?![\w.'"-])`, "gu");
  return when.replace(pattern, (_, quote: string | undefined) =>
    next(quote ?? ""),
  );
};

const readsField = (when: string, names: readonly string[]): boolean =>
  names.some(name => {
    const escaped = name.replaceAll(".", String.raw`\.`);
    return new RegExp(
      String.raw`(?<![\w.-])(?:output\.)?${escaped}(?![\w-])`,
      "u",
    ).test(when);
  });

/** The nodes whose edges read this one's output: it, and routers after it. */
const readersOf = (doc: Document, id: string): Set<string> => {
  const readers = new Set([id]);
  for (const reader of readers) {
    for (const item of edgeItems(doc)) {
      const entry = entryOf(doc, item);
      if (entry === undefined || !entry.froms.includes(reader)) continue;
      for (const target of entry.tos) {
        const type: unknown = doc.getIn(["nodes", target, "type"]);
        if (type === "control.router" || type === "control.split") {
          readers.add(target);
        }
      }
    }
  }
  return readers;
};

/** Every edge whose `when:` reads this value of this node's field. */
const readingEdges = (
  doc: Document,
  id: string,
  field: string,
  value: unknown,
): { when: unknown; at: number; label: string }[] => {
  const names = fieldNames(doc, id, field);
  const readers = readersOf(doc, id);
  return edgeItems(doc).flatMap((item, at) => {
    const entry = entryOf(doc, item);
    const text = entry?.when;
    if (entry === undefined || text === undefined || !isMap(item)) return [];
    return entry.froms.some(from => readers.has(from)) &&
      readsField(text, names) &&
      replaceValue(text, value, () => "\u0000") !== text
      ? [
          {
            when: item.get("when", true),
            at,
            label: `${entry.froms.join(", ")} -> ${entry.tos.join(", ")}`,
          },
        ]
      : [];
  });
};

/** Keys beside a gate's options that name one. */
const GATE_KEYS = ["recommended", "default"] as const;

const followOnGate = (
  doc: Document,
  id: string,
  from: unknown,
  to: unknown,
): void => {
  for (const key of GATE_KEYS) {
    const path = ["nodes", id, key];
    if (doc.getIn(path) === from) doc.setIn(path, to);
  }
};

/**
 * Applies a change to a node's list of values, keeping what reads it true: one
 * value swapped for another is a rename, and one gone that's read is refused.
 */
export const followingValues = (
  doc: Document,
  path: EditPath,
  apply: () => void,
): void => {
  const list = listAt(path);
  if (list === undefined) {
    apply();
    return;
  }
  const before = valuesAt(doc, list.at);
  apply();
  const after = valuesAt(doc, list.at);
  const gone = before.filter(value => !after.includes(value));
  const added = after.filter(value => !before.includes(value));
  const [from] = gone;
  const [to] = added;
  if (gone.length === 1 && added.length === 1) {
    for (const { when, at } of readingEdges(doc, list.id, list.field, from)) {
      changeScalar(
        doc,
        when,
        text =>
          replaceValue(text, from, quote =>
            quote === '"' ? JSON.stringify(to) : literalOf(to),
          ),
        ["edges", at, "when"],
      );
    }
    if (list.field === "choice") followOnGate(doc, list.id, from, to);
    return;
  }
  for (const value of gone) {
    const [reader] = readingEdges(doc, list.id, list.field, value);
    if (reader !== undefined) {
      throw new EditRefused(
        `The edge ${reader.label} reads ${String(value)}. Change that condition first.`,
      );
    }
    if (list.field === "choice") {
      for (const key of GATE_KEYS) {
        if (doc.getIn(["nodes", list.id, key]) === value) {
          throw new EditRefused(
            `${list.id}'s ${key} is ${String(value)}. Change that first.`,
          );
        }
      }
    }
  }
};
