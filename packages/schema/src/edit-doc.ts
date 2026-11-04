/**
 * @file Setting and deleting by path in a parsed YAML document (RFC-008), so
 *   that everything not edited stays as written: comments, style and fields Ork
 *   doesn't know. A value that an anchor shares is refused, as changing it
 *   would change another node too.
 */

import {
  type Document,
  isAlias,
  isCollection,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Pair,
  visit,
  YAMLMap,
  YAMLSeq,
} from "yaml";
import type { z } from "zod";

import { childOf, inCanonicalOrder, keysOf, sameValue } from "./edit-order.ts";

export type EditPath = readonly (string | number)[];

/** Why an edit can't be made; nothing is changed. */
export class EditRefused extends Error {}

const shownPath = (path: EditPath): string =>
  path.length === 0 ? "the workflow" : path.join(".");

/** The anchors some alias in the document reads. */
const sharedAnchors = (doc: Document): Set<string> => {
  const names = new Set<string>();
  visit(doc, {
    Alias: (_key, alias) => {
      names.add(alias.source);
    },
  });
  return names;
};

export const refuseShared = (
  doc: Document,
  node: unknown,
  path: EditPath,
): void => {
  const shared =
    isAlias(node) ||
    (isNode(node) &&
      "anchor" in node &&
      typeof node.anchor === "string" &&
      sharedAnchors(doc).has(node.anchor));
  if (shared) {
    throw new EditRefused(
      `${shownPath(path)} is shared through a YAML anchor, so changing it here would change another node too. Replace the anchor in the file first.`,
    );
  }
};

const keyOf = (pair: Pair): unknown =>
  isScalar(pair.key) ? pair.key.value : pair.key;

/** The value of a map's or list's child, as a node. */
export const childNode = (parent: unknown, key: string | number): unknown =>
  isMap(parent) || isSeq(parent) ? parent.get(key, true) : undefined;

/** A key added to a map, before the first existing key that follows it. */
const insertPair = (
  doc: Document,
  map: YAMLMap,
  key: string,
  value: unknown,
  schema: z.ZodType | undefined,
): void => {
  // A map written as `{}` can't take block children and stay readable.
  if (map.items.length === 0) map.flow = false;
  const order = keysOf(schema, map.toJS(doc));
  const rank = order.indexOf(key);
  const next =
    rank === -1
      ? -1
      : map.items.findIndex(pair => {
          const at = order.indexOf(String(keyOf(pair)));
          return at > rank;
        });
  const pair = doc.createPair(key, value);
  if (next === -1) map.items.push(pair);
  else map.items.splice(next, 0, pair);
};

/** A new node with what an old one carried: its comments and the gap above. */
const inPlaceOf = (doc: Document, old: unknown, value: unknown): unknown => {
  const fresh = doc.createNode(value);
  if (isNode(old) && isNode(fresh)) {
    fresh.comment = old.comment ?? null;
    fresh.commentBefore = old.commentBefore ?? null;
    if (old.spaceBefore === true) fresh.spaceBefore = true;
    if (isCollection(old) && isCollection(fresh) && old.flow === true) {
      fresh.flow = true;
    }
  }
  return fresh;
};

/** `old` changed to `value`, keeping every part of it that stays the same. */
export const updated = (
  doc: Document,
  old: unknown,
  value: unknown,
  schema: z.ZodType | undefined,
  path: EditPath,
): unknown => {
  const current: unknown = isNode(old) ? old.toJS(doc) : old;
  if (sameValue(current, value)) return old;
  refuseShared(doc, old, path);
  const ordered = inCanonicalOrder(value, schema);
  if (
    isMap(old) &&
    typeof ordered === "object" &&
    ordered !== null &&
    !Array.isArray(ordered)
  ) {
    updateMap(doc, old, Object.entries(ordered), schema, path);
    return old;
  }
  if (isSeq(old) && Array.isArray(ordered)) {
    updateSeq(doc, old, ordered, schema, path);
    return old;
  }
  return inPlaceOf(doc, old, ordered);
};

const updateMap = (
  doc: Document,
  map: YAMLMap,
  entries: readonly (readonly [string, unknown])[],
  schema: z.ZodType | undefined,
  path: EditPath,
): void => {
  const keys = new Set(entries.map(([key]) => key));
  const whole = map.toJS(doc) as unknown;
  map.items = map.items.filter(pair => keys.has(String(keyOf(pair))));
  for (const [key, value] of entries) {
    const pair = map.items.find(p => String(keyOf(p)) === key);
    const child = childOf(schema, key, whole);
    if (pair === undefined) {
      insertPair(doc, map, key, value, schema);
    } else {
      pair.value = updated(doc, pair.value, value, child, [...path, key]);
    }
  }
};

/**
 * A list changed in place. An item that stays keeps its comments wherever it
 * moves to, and a changed one takes the place of one that's gone.
 */
const updateSeq = (
  doc: Document,
  seq: YAMLSeq,
  values: readonly unknown[],
  schema: z.ZodType | undefined,
  path: EditPath,
): void => {
  const whole = seq.toJS(doc) as unknown;
  const child = (index: number) => childOf(schema, index, whole);
  const plainOf = (item: unknown): unknown =>
    isNode(item) ? item.toJS(doc) : item;
  const free = seq.items.map(item => ({ item, value: plainOf(item) }));
  const kept = values.map(value => {
    const at = free.findIndex(old => sameValue(old.value, value));
    return at === -1 ? undefined : free.splice(at, 1)[0];
  });
  const items = values.map((value, index) => {
    const same = kept[index];
    if (same !== undefined) return same.item;
    const other = free.shift();
    return other === undefined
      ? doc.createNode(value)
      : updated(doc, other.item, value, child(index), [...path, index]);
  });
  seq.items = items;
};

/** What a missing step of a path becomes: a list for an index, else a map. */
const emptyFor = (next: string | number): YAMLMap | YAMLSeq =>
  typeof next === "number" ? new YAMLSeq() : new YAMLMap();

/** Sets a child that may not exist yet in its map or list. */
const setChild = (
  doc: Document,
  parent: YAMLMap | YAMLSeq,
  key: string | number,
  value: unknown,
  schema: z.ZodType | undefined,
  path: EditPath,
): void => {
  if (isMap(parent) && typeof key === "string") {
    const pair = parent.items.find(p => String(keyOf(p)) === key);
    if (pair === undefined) insertPair(doc, parent, key, value, schema);
    else pair.value = value;
    return;
  }
  if (isSeq(parent) && typeof key === "number" && key <= parent.items.length) {
    parent.items[key] = isNode(value) ? value : doc.createNode(value);
    return;
  }
  throw new EditRefused(`${shownPath(path)} doesn't fit what's there.`);
};

/** Sets the value at `path`, creating what leads to it. */
export const setAt = (
  doc: Document,
  path: EditPath,
  value: unknown,
  root: z.ZodType,
): void => {
  const [last] = path.slice(-1);
  if (last === undefined) throw new EditRefused("An edit needs a path.");
  let parent: unknown = doc.contents;
  let schema: z.ZodType | undefined = root;
  for (const [index, key] of path.slice(0, -1).entries()) {
    if (!isMap(parent) && !isSeq(parent)) {
      throw new EditRefused(`${shownPath(path)} doesn't fit what's there.`);
    }
    const whole = parent.toJS(doc) as unknown;
    const at = path.slice(0, index + 1);
    let child = childNode(parent, key);
    refuseShared(doc, child, at);
    if (child === undefined || (isScalar(child) && child.value === null)) {
      const fresh = emptyFor(path[index + 1] ?? "");
      // `nodes: # none yet` has its comment on the empty value.
      if (isScalar(child) && typeof child.comment === "string") {
        fresh.commentBefore = child.comment;
      }
      child = fresh;
      setChild(doc, parent, key, child, schema, at);
    }
    schema = childOf(schema, key, whole);
    parent = child;
  }
  if (!isMap(parent) && !isSeq(parent)) {
    throw new EditRefused(`${shownPath(path)} doesn't fit what's there.`);
  }
  const whole = parent.toJS(doc) as unknown;
  const old = childNode(parent, last);
  const child = childOf(schema, last, whole);
  const ordered = inCanonicalOrder(value, child);
  setChild(
    doc,
    parent,
    last,
    old === undefined ? ordered : updated(doc, old, value, child, path),
    schema,
    path,
  );
};
