/**
 * @file `ork send` (RFC-005): a program in a tool node writes to a session on
 *   its run's bus. It prints nothing when it works, as what a program prints is
 *   its node's output, and says why on stderr, with exit 1, when it is refused:
 *   before reading a message it could not send, and for anything wrong with the
 *   command itself, which would otherwise go to stdout as usage.
 */

import {
  type EventStore,
  MESSAGE_LIMIT,
  openStore,
  scriptRefusal,
  sendFromScript,
  TOO_LONG,
} from "@krapht/ork-core";
import { inheritedScrubber } from "@krapht/ork-nodes";
import { defineCommand } from "citty";

import { writeErr } from "../output.ts";

const refuse = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

/** Stdin, up to the limit: past it, the rest is not worth holding. */
const readBounded = async (): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += part.length;
    if (size > MESSAGE_LIMIT) return null;
    chunks.push(part);
  }
  return Buffer.concat(chunks);
};

/** The message, or why it can't go. */
const bodyOf = async (
  given: string | undefined,
): Promise<{ body: string } | { refused: string }> => {
  if (given !== undefined) return { body: given };
  const read = await readBounded();
  if (read === null) return { refused: TOO_LONG };
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(read) };
  } catch {
    return { refused: "The message is not UTF-8 text." };
  }
};

const deliver = async (
  store: EventStore,
  to: string,
  given: string | undefined,
): Promise<void> => {
  const sender = {
    run: process.env["ORK_RUN"],
    node: process.env["ORK_NODE"],
    to,
  };
  const refused = scriptRefusal(store, sender);
  if (refused !== null) {
    refuse(refused);
    return;
  }
  const message = await bodyOf(given);
  if ("refused" in message) {
    refuse(message.refused);
    return;
  }
  // Control characters are not a message any more than spaces are.
  if (message.body.replaceAll(/[\p{Cc}\s]/gu, "") === "") {
    refuse("The message is empty.");
    return;
  }
  const sent = await sendFromScript(store, {
    ...sender,
    // Before it reaches the store: a program may well pass on what it read.
    body: inheritedScrubber(process.env)(message.body),
  });
  if (!sent.ok) refuse(sent.error);
};

export const send = defineCommand({
  meta: {
    name: "send",
    description: "From a tool node's program: write to a session in its run",
  },
  args: {
    to: {
      type: "positional",
      description: "The node to write to: the owner, or a channel",
      // Checked below: citty prints its usage to stdout, the node's output.
      required: false,
    },
    message: {
      type: "string",
      alias: "m",
      description: "The message",
    },
    stdin: {
      type: "boolean",
      description: "Read the message from stdin",
      default: false,
    },
  },
  run: async ({ args }) => {
    if (args.to === undefined || args._.length !== 1) {
      refuse("Give one node to write to: ork send <to> -m <body>.");
      return;
    }
    if ((args.message === undefined) === !args.stdin) {
      refuse("Give the message with -m or --stdin, one of them.");
      return;
    }
    const store = openStore();
    try {
      await deliver(store, args.to, args.message);
    } finally {
      store.close();
    }
  },
});
