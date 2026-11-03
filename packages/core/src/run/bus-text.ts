/**
 * @file What the message bus says to a session: the notice of unread messages,
 *   the user's own words, and a question for an owner.
 */

import type { InboxMessage } from "../runtime/types.ts";
import type { OwnerQuestion } from "./bus-events.ts";

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** What a live session sees when its inbox has unread messages. */
export const inboxNotice = (unread: readonly InboxMessage[]): string =>
  `[ork] ${plural(unread.length, "unread message")} from ${[...new Set(unread.map(m => m.from))].join(", ")}. Call read_inbox to read them.`;

/** What a session sees when the user writes to it. */
export const userMessageText = (body: string): string =>
  `[ork] The user writes to you (ork chat):\n${body}`;

/** What an owner sees when Ork asks it about a node it owns. */
export const ownerQuestionText = (
  id: string,
  node: string,
  question: OwnerQuestion,
): string =>
  [
    `[ork] Question ${id} for you, as the owner of ${node}: ${question.question}`,
    ...(question.context === undefined ? [] : [question.context]),
    `Options: ${question.options.map(o => (o.description === undefined ? o.id : `${o.id} (${o.description})`)).join("; ")}.${question.recommended === undefined ? "" : ` Recommended: ${question.recommended}.`}`,
    `Answer with the answer tool (question "${id}").`,
  ].join("\n");
