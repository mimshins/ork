/**
 * @file The edits that take something away or follow a new name (RFC-008):
 *   deleting by path, changing one scalar in place, and refusing a result that
 *   left an alias with nothing to read.
 */

import { type Document, isAlias, isMap, isScalar, isSeq, visit } from "yaml";

import {
  childNode,
  EditRefused,
  type EditPath,
  refuseShared,
} from "./edit-doc.ts";

/** A node stays when its last field goes: it's still in the workflow. */
const isNodeItself = (path: EditPath): boolean =>
  path.length <= 2 && path[0] === "nodes";

/**
 * Deletes what's at `path`, and any map or list left empty by that, since an
 * empty one says nothing.
 */
export const deleteAt = (doc: Document, path: EditPath): void => {
  const [last] = path.slice(-1);
  if (last === undefined) throw new EditRefused("An edit needs a path.");
  const parentPath = path.slice(0, -1);
  let parent: unknown = doc.contents;
  for (const [index, key] of parentPath.entries()) {
    refuseShared(doc, parent, parentPath.slice(0, index));
    parent = childNode(parent, key);
  }
  refuseShared(doc, parent, parentPath);
  if (!isMap(parent) && !isSeq(parent)) return;
  if (childNode(parent, last) === undefined) return;
  parent.delete(last);
  if (
    parent.items.length === 0 &&
    parentPath.length > 0 &&
    !isNodeItself(parentPath)
  ) {
    deleteAt(doc, parentPath);
  }
};

/**
 * Changes a scalar a rename reaches, in place so its comment stays. An alias
 * can't change here without changing what it shares, so that's refused.
 */
export const changeScalar = (
  doc: Document,
  node: unknown,
  change: (text: string) => string,
  path: EditPath,
): void => {
  const target = isAlias(node) ? node.resolve(doc) : node;
  if (!isScalar(target) || typeof target.value !== "string") return;
  const next = change(target.value);
  if (next === target.value) return;
  if (isAlias(node)) refuseShared(doc, node, path);
  target.value = next;
  delete target.source;
};

/** Refuses a result with an alias whose anchor went with what was removed. */
export const refuseLostAnchors = (doc: Document): void => {
  visit(doc, {
    Alias: (_key, alias) => {
      if (alias.resolve(doc) === undefined) {
        throw new EditRefused(
          `Something else shares this through the anchor \`${alias.source}\`, so it can't be removed. Replace the anchor in the file first.`,
        );
      }
    },
  });
};
