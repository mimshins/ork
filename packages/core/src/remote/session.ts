/**
 * @file What a run's events say about one node's session: whether the node is
 *   in the run, whether it has a session to talk to, whether it is running, and
 *   where its session ran. `ork chat` and the local server read it before they
 *   send a node a message.
 */

import type { Driver } from "@krapht/ork-schema";

import type { Checkout, NodeOutput } from "../run/types.ts";
import type { StoredEvent } from "../store/types.ts";

/** What a run's events say about one node's session. */
export type NodeSession = {
  /** Declared in the run, or started in it (a spawned worker). */
  known: boolean;
  /** A leader or worker: a node with a session to talk to. */
  chattable: boolean;
  /** Started and not finished. */
  running: boolean;
  sessionId?: string;
  cwd?: string;
  driver?: Driver;
  /** The node's own worktree, if it had one. */
  checkout?: Checkout;
};

const chattable = (type: string): boolean =>
  type === "claude.leader" || type === "claude.worker";

/** Reads `node`'s session from a run's events, and every node's last output. */
export const nodeSession = (
  events: readonly StoredEvent[],
  node: string,
): { session: NodeSession; outputs: Record<string, NodeOutput> } => {
  const session: NodeSession = {
    known: false,
    chattable: false,
    running: false,
  };
  const outputs: Record<string, NodeOutput> = {};
  for (const { event } of events) {
    if (event.type === "run.started") {
      const declared = event.nodes.find(n => n.id === node);
      if (declared !== undefined) {
        session.known = true;
        session.chattable = chattable(declared.type);
      }
    }
    if (event.type === "node.finished") outputs[event.id] = event.output;
    if (!("id" in event) || event.id !== node) continue;
    if (event.type === "node.started") {
      session.known = true;
      session.chattable = chattable(event.nodeType);
      session.running = true;
    }
    if (event.type === "node.finished") session.running = false;
    if (event.type === "worktree" && event.action === "created") {
      session.checkout = {
        path: event.path,
        ...(event.branch === undefined ? {} : { branch: event.branch }),
        own: true,
        owner: node,
      };
    }
    if (event.type !== "node.event") continue;
    const inner = event.event;
    // A fork of a leader's session answered a question; it isn't the node's.
    if (inner.fork === true) continue;
    if (inner.type === "session.started") {
      session.sessionId = inner.sessionId;
      if (inner.cwd !== undefined) session.cwd = inner.cwd;
      if (inner.driver !== undefined) session.driver = inner.driver;
    }
    if (inner.type === "session.finished" && inner.outcome.sessionId !== "") {
      session.sessionId = inner.outcome.sessionId;
    }
  }
  return { session, outputs };
};
