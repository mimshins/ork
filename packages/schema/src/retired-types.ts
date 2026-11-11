/** @file The node types RFC-015 renamed, and the one that replaces each. */

import type { NodeType } from "./nodes.ts";

/**
 * The node types RFC-015 renamed, and the one that replaces each: refused in a
 * workflow with the way out (`ork migrate`), never read as the new one.
 */
export const RETIRED_NODE_TYPES: Readonly<Record<string, NodeType>> = {
  "claude.leader": "agent.leader",
  "claude.worker": "agent.worker",
  "claude.subagent": "agent.subagent",
};
