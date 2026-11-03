/**
 * @file `send_message`, `read_inbox` and `answer`: a session's side of the
 *   run's message bus. A message lands in the recipient's inbox and a live
 *   session gets a one-line notice; `answer` replies to a question Ork asked an
 *   owner about a node it owns. Only sessions inside a run get them.
 */

import { z } from "zod";

import { defineTool, text, type ToolContext } from "./tool.ts";

/**
 * Peers are mutual: a node no one may write to has no inbox to read, unless it
 * may be linked later, since a session's tools are set when it starts.
 */
const hasPeers = ({ ports }: ToolContext): boolean =>
  (ports.mailbox?.peers().length ?? 0) > 0 ||
  ports.mailbox?.linkable() === true;

const MAX_WAIT_SECONDS = 3600;
const DEFAULT_WAIT_SECONDS = 300;

const inboxText = (unread: readonly { from: string; body: string }[]): string =>
  JSON.stringify({
    messages: unread.map(m => ({ from: m.from, body: m.body })),
  });

export const sendMessageTool = defineTool({
  name: "send_message",
  description:
    "Send a short message to a node you can reach: your owner, a node you own, one you share a declared channel with, or a node of another run the user linked you to. It sees a notice and reads the message with read_inbox. Use it for what they need to know now; your report still goes to your owner at the end.",
  shape: {
    to: z
      .string()
      .describe("The node's id, or <run>/<node> for a linked node."),
    body: z
      .string()
      .min(1)
      .describe("Self-contained: the recipient does not see your work."),
  },
  available: hasPeers,
  run: ({ ports }, args) => {
    const sent = ports.mailbox?.send(args.to, args.body);
    if (sent === undefined) return Promise.resolve(text("No message bus."));
    if (!sent.ok) return Promise.resolve(text(`Not sent: ${sent.error}.`));
    return Promise.resolve(
      text(
        sent.delivered === "now"
          ? `Sent to ${args.to}; it sees a notice at its next step.`
          : `Sent to ${args.to}; it is not running now and sees the message if it starts again.`,
      ),
    );
  },
});

export const readInboxTool = defineTool({
  name: "read_inbox",
  description:
    "Read your unread messages from other nodes, oldest first. Ork tells you when one arrives.",
  shape: {},
  available: hasPeers,
  run: ({ ports }) => {
    const unread = ports.mailbox?.read() ?? [];
    return Promise.resolve(
      text(unread.length === 0 ? "No unread messages." : inboxText(unread)),
    );
  },
});

export const waitForMessagesTool = defineTool({
  name: "wait_for_messages",
  description:
    "Wait for a message from another node when you cannot go on without its reply, instead of ending your session. Returns what arrived, or says none did in time. You hold no session slot while you wait.",
  shape: {
    timeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(MAX_WAIT_SECONDS)
      .optional()
      .describe(`How long to wait. Default: ${String(DEFAULT_WAIT_SECONDS)}.`),
  },
  available: hasPeers,
  run: async ({ ports }, args) => {
    const seconds = args.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
    await ports.mailbox?.wait(seconds * 1000);
    const unread = ports.mailbox?.read() ?? [];
    return text(
      unread.length === 0
        ? `No message yet, after waiting up to ${String(seconds)} seconds. Ork may have told you something; if not, wait again or go on.`
        : inboxText(unread),
    );
  },
});

export const answerTool = defineTool({
  name: "answer",
  description:
    "Answer a question Ork asked you as the owner of a node, such as a loop of yours that ran out of rounds. The question's id and options are in Ork's message.",
  shape: {
    question: z.string().describe("The question's id, e.g. 'q1'."),
    choice: z.string().describe("One of its options."),
  },
  available: ({ ports }) =>
    ports.mailbox !== undefined && ports.ownership !== undefined,
  run: ({ ports }, args) => {
    const answered = ports.mailbox?.answer(args.question, args.choice);
    if (answered === undefined) return Promise.resolve(text("No questions."));
    return Promise.resolve(
      text(
        answered.ok
          ? `Answered ${args.question}: ${args.choice}.`
          : `Not answered: ${answered.error}.`,
      ),
    );
  },
});
