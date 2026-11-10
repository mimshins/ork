/**
 * @file What a node's activation records: that it started, its session's or
 *   tool's events, how it finished (with its end kind,
 *   specs/runtime/session-ends.md), or that a dead path skipped it.
 */

import type { NodeType } from "@krapht/ork-schema";

import type { AgentRef } from "../agents/apply.ts";
import type {
  RuntimeEvent,
  SessionEnd,
  SessionUsage,
} from "../runtime/types.ts";
import type { NodeOutput } from "./types.ts";

export type NodeEvent =
  | {
      type: "node.started";
      id: string;
      nodeType: NodeType;
      round: number;
      /** The leader that delegated this run, if one did. */
      owner?: string;
      /** The agent that fills the node, if one does. */
      agent?: AgentRef;
      /** For an item of a fanned node, which node and which entry. */
      item?: { of: string; index: number };
    }
  | { type: "node.event"; id: string; event: RuntimeEvent }
  | {
      type: "node.finished";
      id: string;
      round: number;
      ok: boolean;
      output: NodeOutput;
      usage?: SessionUsage;
      error?: string;
      /** How it ended; absent on runs from before, which `endOf` reads. */
      end?: SessionEnd;
    }
  | { type: "node.skipped"; id: string };
