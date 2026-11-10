/**
 * @file Resolves how nodes ended for the API: each `node.finished` event (read
 *   through core's `endOf`, so a run stored before ends existed gets a kind
 *   too) and each tree node get an `EndView` (contract-ends.ts).
 */

import {
  END_KINDS,
  endOf,
  type SessionEnd,
  type StoredEvent as CoreStoredEvent,
  type TreeNode as CoreTreeNode,
} from "@krapht/ork-core";

import type { EndView, StoredEvent, TreeNode } from "./contract-ends.ts";

/** Core's hints send the reader to Details; with no detail there is none. */
const HINT_TO_DETAILS =
  /\bIts (?:last )?(?:output|detail) is under Details(?:; |\.\s*)/u;

const hintFor = (hint: string, hasDetail: boolean): string => {
  if (hasDetail) return hint;
  const rest = hint.replace(HINT_TO_DETAILS, "");
  return rest === "" ? rest : rest[0]?.toUpperCase() + rest.slice(1);
};

export const endViewOf = (end: SessionEnd): EndView => {
  const info = END_KINDS[end.kind];
  return {
    kind: end.kind,
    message: end.message,
    ...(end.detail === undefined ? {} : { detail: end.detail }),
    label: info.label,
    actor: info.actor,
    transient: info.transient,
    hint: hintFor(info.hint, end.detail !== undefined),
    docsAnchor: info.docsAnchor,
  };
};

/** The event as served: a `node.finished` gets its `end`, old ones too. */
export const servedEvent = (stored: CoreStoredEvent): StoredEvent => {
  const { event } = stored;
  return event.type === "node.finished"
    ? { ...stored, event: { ...event, end: endViewOf(endOf(event)) } }
    : { ...stored, event };
};

/**
 * The tree with each node's latest end, from the events it was folded from. A
 * node that started again has none until it finishes; a failed node's `now` is
 * the end's message, not the raw error.
 */
export const treeWithEnds = (
  roots: readonly CoreTreeNode[],
  stored: readonly CoreStoredEvent[],
): TreeNode[] => {
  const ends = new Map<string, EndView>();
  for (const { event } of stored) {
    if (event.type === "node.started") ends.delete(event.id);
    else if (event.type === "node.finished") {
      ends.set(event.id, endViewOf(endOf(event)));
    }
  }
  const dress = (node: CoreTreeNode): TreeNode => {
    const end = ends.get(node.id);
    const children = node.children.map(dress);
    if (end === undefined) return { ...node, children };
    const failed = node.state === "failed" && end.actor !== null;
    return {
      ...node,
      ...(failed ? { now: end.message } : {}),
      end,
      children,
    };
  };
  return roots.map(node => dress(node));
};
