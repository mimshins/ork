/**
 * @file The run events of the message bus and claims: messages between nodes,
 *   questions Ork asks an owner, the user's own messages (`ork chat`), and
 *   claims taken, refused and released. Part of `RunEvent`.
 */

import type { DecisionChoice } from "../runtime/types.ts";

export type BusEvent =
  /** `node` wrote to `to` on the message bus; `message` is its number. */
  | {
      type: "message.sent";
      node: string;
      to: string;
      message: number;
      body: string;
    }
  | { type: "message.read"; node: string; ids: number[] }
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
