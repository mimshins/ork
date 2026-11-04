/**
 * @file What one authored edge entry says (RFC-008): reading it from a YAML
 *   document, writing a new one, and which edges are left when one is taken
 *   out.
 */

import {
  type Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  type YAMLSeq,
} from "yaml";

import { formatEdge } from "./edges.ts";
import { isRecord } from "./edit-order.ts";
import type { EdgeInput } from "./workflow.ts";

/** What one authored entry says. */
export type Entry = {
  froms: readonly string[];
  tos: readonly string[];
  when?: string | undefined;
  maxRounds?: number | undefined;
  /** What else it holds: fields Ork doesn't know, values of the wrong kind. */
  extra: Readonly<Record<string, unknown>>;
};

export type EdgeOptions = { when?: string; maxRounds?: number };

const listOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string",
  );

const splitSide = (side: string): string[] =>
  side
    .split(",")
    .map(id => id.trim())
    .filter(id => id.length > 0);

export const entryOf = (doc: Document, raw: unknown): Entry | undefined => {
  const item = isAlias(raw) ? raw.resolve(doc) : raw;
  if (isScalar(item) && typeof item.value === "string") {
    const parts = item.value.split("->");
    return parts.length === 2
      ? {
          froms: splitSide(parts[0] ?? ""),
          tos: splitSide(parts[1] ?? ""),
          extra: {},
        }
      : undefined;
  }
  if (!isMap(item)) return undefined;
  const value: unknown = item.toJS(doc);
  if (!isRecord(value)) return undefined;
  const { from, to, when, maxRounds, ...rest } = value;
  const whenIsText = typeof when === "string";
  const roundsIsNumber = typeof maxRounds === "number";
  return {
    froms: listOf(from),
    tos: listOf(to),
    when: whenIsText ? when : undefined,
    maxRounds: roundsIsNumber ? maxRounds : undefined,
    extra: {
      ...rest,
      ...(when === undefined || whenIsText ? {} : { when }),
      ...(maxRounds === undefined || roundsIsNumber ? {} : { maxRounds }),
    },
  };
};

const sideOf = (ids: readonly string[]): string | string[] =>
  ids.length === 1 ? (ids[0] ?? "") : [...ids];

/** An entry as it's first written: the shortest form that says it all. */
export const authored = (entry: Entry): unknown => {
  const plain = {
    from: sideOf(entry.froms),
    to: sideOf(entry.tos),
    ...(entry.when === undefined ? {} : { when: entry.when }),
    ...(entry.maxRounds === undefined ? {} : { maxRounds: entry.maxRounds }),
  };
  return Object.keys(entry.extra).length === 0
    ? formatEdge(plain satisfies EdgeInput)
    : { ...plain, ...entry.extra };
};

export const edgesOf = (doc: Document): YAMLSeq | undefined => {
  const edges = doc.get("edges", true);
  return isSeq(edges) ? edges : undefined;
};

/** Each authored entry, as written. */
export const edgeItems = (doc: Document): readonly unknown[] =>
  edgesOf(doc)?.items ?? [];

export const says = (entry: Entry, from: string, to: string): boolean =>
  entry.froms.includes(from) && entry.tos.includes(to);

export const isOnly = (entry: Entry, from: string, to: string): boolean =>
  entry.froms.length === 1 && entry.tos.length === 1 && says(entry, from, to);

/** What's left of an entry without `from -> to`, and what must split off. */
export const without = (
  entry: Entry,
  from: string,
  to: string,
): {
  keep?: { froms: readonly string[]; tos: readonly string[] };
  split?: Entry;
} => {
  const froms = entry.froms.filter(id => id !== from);
  const tos = entry.tos.filter(id => id !== to);
  if (froms.length === 0 && tos.length === 0) return {};
  if (froms.length === 0) return { keep: { froms: entry.froms, tos } };
  if (tos.length === 0) return { keep: { froms, tos: entry.tos } };
  return {
    keep: { froms, tos: entry.tos },
    split: { ...entry, froms: [from], tos },
  };
};

const said = (comment: string | null | undefined): boolean =>
  typeof comment === "string" && comment !== "";

/** Whether a written-out entry has a comment anywhere in it. */
export const hasComment = (value: unknown): boolean => {
  if (isScalar(value)) {
    return said(value.comment) || said(value.commentBefore);
  }
  if (isSeq(value)) {
    return said(value.commentBefore) || value.items.some(hasComment);
  }
  if (isMap(value)) {
    return (
      said(value.commentBefore) ||
      value.items.some(pair => hasComment(pair.key) || hasComment(pair.value))
    );
  }
  return false;
};
