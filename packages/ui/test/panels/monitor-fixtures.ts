/** @file A node of a run's tree, for the Monitor's tests. */

import type { TreeNode } from "@krapht/ork-server/client";

export const treeNode = (
  id: string,
  over: Partial<TreeNode> = {},
): TreeNode => ({
  id,
  type: "claude.worker",
  state: "waiting",
  runs: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  children: [],
  ...over,
});
