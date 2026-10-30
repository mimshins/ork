/**
 * @file `send_message`, `read_inbox` and `answer`: a session's side of the
 *   run's message bus. A message lands in the recipient's inbox and a live
 *   session gets a one-line notice; `answer` replies to a question Ork asked an
 *   owner about a node it owns. Only sessions inside a run get them.
 */

import { z } from "zod";

import { defineTool, text, type ToolContext } from "./tool.ts";

/** Peers are mutual: a node no one may write to has no inbox to read. */
const hasPeers = ({ ports }: ToolContext): boolean =>
  (ports.mailbox?.peers().length ?? 0) > 0;

export const sendMessageTool = defineTool({
  name: "send_message",
  description:
    "Send a short message to another node in this run: your owner, a node you own, or one you share a declared channel with. It sees a notice and reads the message with read_inbox. Use it for what they need to know now; your report still goes to your owner at the end.",
  shape: {
    to: z.string().describe("The node's id."),
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
          : `Sent to ${args.to}; it is not running now and sees the message when it next starts.`,
      ),
    );
  },
});

export const readInboxTool = defineTool({
  name: "read_inbox",
  description:
    "Read your unread messages from other nodes in this run, oldest first. Ork tells you when one arrives.",
  shape: {},
  available: hasPeers,
  run: ({ ports }) => {
    const unread = ports.mailbox?.read() ?? [];
    return Promise.resolve(
      text(
        unread.length === 0
          ? "No unread messages."
          : JSON.stringify({
              messages: unread.map(m => ({ from: m.from, body: m.body })),
            }),
      ),
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
