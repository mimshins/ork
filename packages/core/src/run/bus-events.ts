/**
 * @file The run events of the message bus and claims: messages between nodes,
 *   questions Ork asks an owner, the user's own messages (`ork chat`), and
 *   claims taken, refused and released. Part of `RunEvent`.
 */

import type {
  DecisionChoice,
  InboxMessage,
  MessageVia,
} from "../runtime/types.ts";

/** A question Ork asks a node's owner. */
export type OwnerQuestion = {
  question: string;
  options: DecisionChoice[];
  recommended?: string;
  context?: string;
};

/**
 * What a resumed run's bus starts with (`resumeState`): each node's unread
 * messages, the user's messages still queued, and the last message number.
 */
export type Mail = {
  inboxes: ReadonlyMap<string, readonly InboxMessage[]>;
  waiting: ReadonlyMap<string, readonly string[]>;
  last: number;
  /** Call node -> the run it last started. */
  calls: ReadonlyMap<string, string>;
};

export type BusEvent =
  /** `node` wrote to `to` on the message bus; `message` is its number. */
  | {
      type: "message.sent";
      node: string;
      to: string;
      message: number;
      body: string;
      /** `rule`: no session wrote it, a `notify:` of `node` did. */
      via?: MessageVia;
    }
  /**
   * A linked node of another run (`from`, `<run>/<node>`) wrote to `node`, or,
   * `via` `script`, a program in the tool node `from` did.
   */
  | {
      type: "message.received";
      node: string;
      from: string;
      message: number;
      body: string;
      via?: MessageVia;
    }
  | { type: "message.read"; node: string; ids: number[] }
  /** The `workflow.call` node `node` started `workflow` as `run` (RFC-004). */
  | {
      type: "call.started";
      node: string;
      run: string;
      workflow: string;
      project: string;
    }
  /** Ork told `node` a link was made or ended. */
  | { type: "link.notice"; node: string; text: string }
  /** Ork asked `node`, the owner of `about`, a question (a loop out of rounds). */
  | {
      type: "owner.asked";
      node: string;
      about: string;
      question: string;
      text: string;
      options: DecisionChoice[];
      recommended?: string;
    }
  | { type: "owner.answered"; node: string; question: string; answer: string }
  /** The owner's session ended first; the question goes to the human. */
  | { type: "owner.unanswered"; node: string; question: string }
  /**
   * The user wrote to a node (`ork chat`): pushed into its live session now,
   * queued for its next session, or sent by resuming its finished one.
   */
  | {
      type: "user.message";
      node: string;
      body: string;
      delivered: "now" | "queued" | "resumed";
    }
  /** `node` claimed `resource` (a path from the project root, or a name). */
  | { type: "claim.taken"; node: string; resource: string }
  /** `node` could not claim `resource`: `holder` holds `held`, which overlaps. */
  | {
      type: "claim.refused";
      node: string;
      resource: string;
      holder: string;
      held: string;
    }
  /** `node` released `resource`, itself or by finishing. */
  | {
      type: "claim.released";
      node: string;
      resource: string;
      reason: "released" | "finished";
    };
