/**
 * @file The scheduler's view of calling a workflow (RFC-004): what a
 *   `workflow.call` node asks for, rendered, and the port that does it.
 *   Starting a run belongs to whoever hosts this one, so it comes in as a
 *   port.
 */

import type { NodeOutput, NodeResult } from "./types.ts";

export type CallRequest = {
  /** The `workflow.call` node. */
  callId: string;
  workflow: string;
  /** A registered project's id; none stays in this project. */
  project?: string | undefined;
  /** The node to talk to and wait on; it makes the call a conversation. */
  node?: string | undefined;
  inputs: Record<string, string>;
  wait: "run" | "node" | "none";
  ref?: string | undefined;
  maxMessages?: number | undefined;
  /** What the edge that activated it carried. */
  input?: NodeOutput | undefined;
  /** What is left of this run's budget, which caps the called run's. */
  budgetLeftUsd?: number | undefined;
  /** This run's nodes that share a `messages` channel with the call. */
  channels: readonly string[];
  /** The called node's address, once those nodes are linked to it. */
  linked: (address: string) => void;
};

export type CallPort = {
  invoke: (request: CallRequest, signal: AbortSignal) => Promise<NodeResult>;
  /** The caller was stopped: so is every run it called. */
  stopAll: () => void;
};
