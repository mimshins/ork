/**
 * @file Edge edits in a YAML document (RFC-008). An authored entry can stand
 *   for several edges (`a, b -> c, d`), so changing one edge changes only that
 *   entry, splitting it when it must. A written-out entry is edited in place,
 *   so its comments and any field Ork doesn't know stay; only a new entry takes
 *   the shortest form, as the serializer does.
 */

import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isSeq,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";

import { EditRefused, refuseShared, setAt, updated } from "./edit-doc.ts";
import {
  authored,
  edgeItems,
  edgesOf,
  type EdgeOptions,
  type Entry,
  entryOf,
  hasComment,
  isOnly,
  says,
  without,
} from "./edit-edge-entry.ts";
import { isRecord } from "./edit-order.ts";
import { changeScalar, deleteAt } from "./edit-remove.ts";
import { EdgeInputSchema, WorkflowSchema } from "./workflow.ts";

export { edgeItems };

/** A side of a written-out entry cut down to `ids`, in place. */
const narrowSide = (
  doc: Document,
  map: YAMLMap,
  key: "from" | "to",
  ids: readonly string[],
  path: readonly (string | number)[],
): void => {
  const side = map.get(key, true);
  if (isAlias(side)) refuseShared(doc, side, [...path, key]);
  if (!isSeq(side)) return;
  const keeps = (item: unknown): boolean => {
    const value: unknown = isNode(item) ? item.toJS(doc) : item;
    return typeof value !== "string" || ids.includes(value);
  };
  if (side.items.every(keeps)) return;
  refuseShared(doc, side, [...path, key]);
  side.items = side.items.filter(keeps);
};

/** An entry cut down to these edges, in place where it's written out. */
const narrowed = (
  doc: Document,
  item: unknown,
  entry: Entry,
  froms: readonly string[],
  tos: readonly string[],
  path: readonly (string | number)[],
): unknown => {
  if (isAlias(item)) refuseShared(doc, item, path);
  if (!isMap(item)) {
    return updated(
      doc,
      item,
      authored({ ...entry, froms, tos }),
      EdgeInputSchema,
      path,
    );
  }
  narrowSide(doc, item, "from", froms, path);
  narrowSide(doc, item, "to", tos, path);
  return item;
};

/** Removes the items now empty, and the list if that was all of it. */
const replaceItems = (
  doc: Document,
  edges: YAMLSeq,
  items: readonly unknown[],
): void => {
  edges.items = [...items];
  if (edges.items.length === 0) deleteAt(doc, ["edges"]);
};

const refuseNoEdge = (from: string, to: string): never => {
  throw new EditRefused(`There is no edge from ${from} to ${to}.`);
};

/**
 * Which entry an edit of `from -> to` means. Two entries can link the same
 * nodes on different conditions, and an edit touches only the one it's about.
 */
const entryIndex = (
  doc: Document,
  from: string,
  to: string,
  whenWas: string | undefined,
): number => {
  const saying = edgeItems(doc).flatMap((item, index) => {
    const entry = entryOf(doc, item);
    return entry !== undefined && says(entry, from, to)
      ? [{ entry, index }]
      : [];
  });
  const [only] = saying;
  if (only === undefined) return refuseNoEdge(from, to);
  if (saying.length === 1) return only.index;
  const meant = saying.find(({ entry }) => entry.when === whenWas);
  if (meant === undefined) {
    throw new EditRefused(
      `There are ${String(saying.length)} edges from ${from} to ${to}, and none with that condition.`,
    );
  }
  return meant.index;
};

const exists = (doc: Document, from: string, to: string): boolean =>
  edgeItems(doc).some(item => {
    const entry = entryOf(doc, item);
    return entry !== undefined && says(entry, from, to);
  });

/** Adds `from -> to` as its own entry. */
export const connect = (
  doc: Document,
  from: string,
  to: string,
  options: EdgeOptions,
): void => {
  if (exists(doc, from, to)) {
    throw new EditRefused(`${from} is already connected to ${to}.`);
  }
  const entry = authored({ froms: [from], tos: [to], ...options, extra: {} });
  const edges = edgesOf(doc);
  if (edges === undefined) setAt(doc, ["edges"], [entry], WorkflowSchema);
  else edges.items.push(doc.createNode(entry));
};

/** Removes `from -> to`, leaving what else its entry says. */
export const disconnect = (
  doc: Document,
  from: string,
  to: string,
  whenWas?: string,
): void => {
  const index = entryIndex(doc, from, to, whenWas);
  const edges = edgesOf(doc);
  if (edges === undefined) return;
  const items = edges.items.flatMap((item, at) => {
    const entry = at === index ? entryOf(doc, item) : undefined;
    if (entry === undefined) return [item];
    const { keep, split } = without(entry, from, to);
    if (keep === undefined) return [];
    const kept = narrowed(doc, item, entry, keep.froms, keep.tos, [
      "edges",
      at,
    ]);
    return split === undefined
      ? [kept]
      : [kept, doc.createNode(authored(split))];
  });
  replaceItems(doc, edges, items);
};

/**
 * What a whole entry becomes under new options: written out as it was if it
 * must be, to keep what's in it, and otherwise the shortest form.
 */
const withOptions = (doc: Document, item: unknown, next: Entry): unknown => {
  const hasOptions = next.when !== undefined || next.maxRounds !== undefined;
  const custom = Object.keys(next.extra).length > 0;
  if (!isMap(item) || (!hasOptions && !custom && !hasComment(item))) {
    return authored(next);
  }
  const value: unknown = item.toJS(doc);
  const {
    when: _when,
    maxRounds: _rounds,
    ...rest
  } = isRecord(value) ? value : {};
  return {
    ...rest,
    ...(next.when === undefined ? {} : { when: next.when }),
    ...(next.maxRounds === undefined ? {} : { maxRounds: next.maxRounds }),
  };
};

/** Sets `from -> to`'s condition and loop limit, or clears those left out. */
export const setEdge = (
  doc: Document,
  from: string,
  to: string,
  options: EdgeOptions,
  whenWas?: string,
): void => {
  const index = entryIndex(doc, from, to, whenWas);
  const edges = edgesOf(doc);
  if (edges === undefined) return;
  const items = edges.items.flatMap((item, at) => {
    const entry = at === index ? entryOf(doc, item) : undefined;
    if (entry === undefined) return [item];
    const path = ["edges", at];
    const { when: _when, maxRounds: _rounds, ...rest } = entry;
    const own: Entry = { ...rest, froms: [from], tos: [to], ...options };
    if (entry.when === own.when && entry.maxRounds === own.maxRounds) {
      return [item];
    }
    if (isOnly(entry, from, to)) {
      const value = withOptions(doc, item, own);
      return [updated(doc, item, value, EdgeInputSchema, path)];
    }
    const { keep, split } = without(entry, from, to);
    if (keep === undefined) return [];
    return [
      narrowed(doc, item, entry, keep.froms, keep.tos, path),
      ...(split === undefined ? [] : [doc.createNode(authored(split))]),
      doc.createNode(authored(own)),
    ];
  });
  replaceItems(doc, edges, items);
};

/** Takes a removed node out of every entry. */
export const dropFromEdges = (doc: Document, id: string): void => {
  const edges = edgesOf(doc);
  if (edges === undefined) return;
  const items = edges.items.flatMap((item, at) => {
    const entry = entryOf(doc, item);
    if (entry === undefined) return [item];
    const froms = entry.froms.filter(other => other !== id);
    const tos = entry.tos.filter(other => other !== id);
    if (froms.length === 0 || tos.length === 0) return [];
    return froms.length === entry.froms.length &&
      tos.length === entry.tos.length
      ? [item]
      : [narrowed(doc, item, entry, froms, tos, ["edges", at])];
  });
  replaceItems(doc, edges, items);
};

/** Follows a node's new id through every entry, in place. */
export const renameInEdges = (
  doc: Document,
  from: string,
  to: string,
): void => {
  const edges = edgesOf(doc);
  if (edges === undefined) return;
  const follow = (text: string): string => (text === from ? to : text);
  edges.items = edges.items.map((item, at) => {
    const path = ["edges", at];
    if (isMap(item)) {
      for (const key of ["from", "to"]) {
        const side = item.get(key, true);
        for (const scalar of isSeq(side) ? side.items : [side]) {
          changeScalar(doc, scalar, follow, [...path, key]);
        }
      }
      return item;
    }
    const entry = entryOf(doc, item);
    if (entry === undefined || ![...entry.froms, ...entry.tos].includes(from)) {
      return item;
    }
    if (isAlias(item)) refuseShared(doc, item, path);
    return updated(
      doc,
      item,
      authored({
        ...entry,
        froms: entry.froms.map(follow),
        tos: entry.tos.map(follow),
      }),
      EdgeInputSchema,
      path,
    );
  });
};
