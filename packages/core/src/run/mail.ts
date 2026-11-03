/**
 * @file What a resumed run's bus starts with, rebuilt from its events: each
 *   node's unread messages, the user's messages still queued, and the last
 *   message number (specs/messaging.md).
 */

import type { InboxMessage } from "../runtime/types.ts";
import type { Mail } from "./bus-events.ts";
import type { RunEvent } from "./types.ts";

export const mailOf = (events: readonly RunEvent[]): Mail => {
  const inboxes = new Map<string, InboxMessage[]>();
  const waiting = new Map<string, string[]>();
  let last = 0;
  for (const event of events) {
    if (event.type === "message.sent" || event.type === "message.received") {
      last = Math.max(last, event.message);
      const sent = event.type === "message.sent";
      const to = sent ? event.to : event.node;
      // A message to a linked node of another run is in that run's inbox.
      if (!to.includes("/")) {
        const from = sent ? event.node : event.from;
        inboxes.set(to, [
          ...(inboxes.get(to) ?? []),
          { id: event.message, from, body: event.body },
        ]);
      }
    } else if (event.type === "message.read") {
      const read = new Set(event.ids);
      const unread = inboxes.get(event.node) ?? [];
      inboxes.set(
        event.node,
        unread.filter(m => !read.has(m.id)),
      );
    } else if (event.type === "user.message") {
      if (event.delivered === "queued") {
        waiting.set(event.node, [
          ...(waiting.get(event.node) ?? []),
          event.body,
        ]);
      }
    } else if (event.type === "node.started") {
      // Its session got the user's queued messages when it connected.
      waiting.delete(event.id);
    }
  }
  return { inboxes, waiting, last };
};
