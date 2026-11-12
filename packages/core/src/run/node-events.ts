/**
 * @file What a node's activation records: that it started, its session's or
 *   tool's events, how it finished (with its end kind,
 *   specs/runtime/session-ends.md), that a dead path skipped it, or that it
 *   waits for a slot or a lock.
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
  | { type: "node.skipped"; id: string }
  | VerifySkipped
  | MachineEvent;

/**
 * A node's waits for the machine: a slot for a heavy command (ADR-080) and a
 * lock (RFC-016), naming who holds it as `<run>/<node>`.
 */
export type MachineEvent =
  /** A heavy command waits for a machine-wide slot, held by `<run>/<node>`s. */
  | { type: "slot.waiting"; id: string; holders: string[] }
  /** The command that waited got its slot. */
  | { type: "slot.taken"; id: string }
  /** A node waits for a lock another run (or item) holds. */
  | { type: "lock.waiting"; id: string; lock: string; holders: string[] }
  /** A node runs under its lock: it took it, or joined the run's hold. */
  | { type: "lock.taken"; id: string; lock: string }
  /**
   * The run let a lock go: `span` when the last node naming it ended, `run`
   * when the run ended holding it (a resume redoes the locked nodes).
   */
  | { type: "lock.released"; id: string; lock: string; end: "span" | "run" };

/**
 * A check with `once: true` (a `verify:` or a tool node) that did not run: it
 * passed `at` on identical files, run by `who` (`<run>/<node>` or `you`).
 */
export type VerifySkipped = {
  type: "verify.skipped";
  id: string;
  /** The command, as `tool.called` shows it. */
  check: string;
  at: string;
  who: string;
};
