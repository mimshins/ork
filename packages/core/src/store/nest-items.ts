/**
 * @file Puts the items of a node with `forEach` under that node in a run's tree
 *   (RFC-013), for every reader that shows the tree: `ork tree` and the
 *   server's run tree. `runTree` keeps the shape the events give.
 */

import type { TreeNode } from "./view.ts";

/** Whether a tree node is an item of a fanned node (`build.2`). */
export const isItem = (node: TreeNode): boolean =>
  node.template !== undefined && /\.\d+$/u.test(node.id);

/**
 * Moves each item of a node with `forEach` (`build.2`) under its node, in list
 * order, from beside it or under its owner, where the events put it.
 */
export const nestItems = (roots: readonly TreeNode[]): TreeNode[] => {
  const all: TreeNode[] = [];
  const collect = (node: TreeNode): void => {
    all.push(node);
    for (const child of node.children) collect(child);
  };
  for (const root of roots) collect(root);
  const items = all.filter(node => isItem(node));
  const home = new Map(all.map(node => [node.id, node]));
  const isMoved = (node: TreeNode): boolean =>
    items.includes(node) && home.has(node.template ?? "");
  for (const node of all)
    node.children = node.children.filter(c => !isMoved(c));
  for (const item of items) home.get(item.template ?? "")?.children.push(item);
  return roots.filter(root => !isMoved(root));
};
