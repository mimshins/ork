/**
 * @file `ork relay`: introduce two running nodes of different runs so they can
 *   message each other, end that, and list what is linked (RFC-003,
 *   specs/messaging.md). Each side's session is told at its next step, through
 *   the store and its run's socket. Not `ork link`, which points tools' folders
 *   at `.ork/`. A node's address always has a slash, so `end` and `list` cannot
 *   be taken for one.
 */

import {
  addressOf,
  DEFAULT_LINK_MESSAGES,
  type LinkRecord,
  linkNodes,
  openStore,
  unlinkNodes,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";

/** What the words after `ork relay` ask for. */
export type RelayAction =
  | { kind: "link"; a: string; b: string }
  | { kind: "end"; a: string; b: string }
  | { kind: "list"; run?: string }
  | { kind: "usage" };

export const relayAction = (
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
): RelayAction => {
  if (first === "list") {
    return second === undefined
      ? { kind: "list" }
      : { kind: "list", run: second };
  }
  if (first === "end") {
    return second === undefined || third === undefined
      ? { kind: "usage" }
      : { kind: "end", a: second, b: third };
  }
  return first === undefined || second === undefined
    ? { kind: "usage" }
    : { kind: "link", a: first, b: second };
};

export const USAGE = `Name two nodes of different runs as <run>/<node>:
  ork relay <a> <b>       let them message each other
  ork relay end <a> <b>   end that
  ork relay list [run]    list what is linked`;

/** The link's two ends, its count, and whether it is over. */
export const formatLink = (link: LinkRecord): string =>
  `${addressOf(link.a)} <-> ${addressOf(link.b)}  ${String(link.messages)}/${String(link.maxMessages)} messages${link.endedAt === undefined ? "" : style("dim", "  (ended)")}`;

const refuse = (error: string): void => {
  writeErr(error);
  process.exitCode = 1;
};

/** A whole number above zero, `undefined` when not given, `null` when wrong. */
export const maxMessagesOf = (given?: string): number | undefined | null => {
  if (given === undefined) return undefined;
  const limit = Number(given);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
};

export const relay = defineCommand({
  meta: {
    name: "relay",
    description:
      "Let two running nodes of different runs message each other; `end` and `list` too",
  },
  args: {
    first: {
      type: "positional",
      description: "A node as <run>/<node>, or `end`, or `list`",
      required: false,
    },
    second: {
      type: "positional",
      description: "The other node",
      required: false,
    },
    third: {
      type: "positional",
      description: "With `end`: the other node",
      required: false,
    },
    "max-messages": {
      type: "string",
      description: `Ask you whether to go on after this many messages (default ${String(DEFAULT_LINK_MESSAGES)})`,
    },
    all: {
      type: "boolean",
      description: "With `list`: include links that have ended",
      default: false,
    },
    json: {
      type: "boolean",
      description: "With `list`: print JSON",
      default: false,
    },
  },
  run: async ({ args }) => {
    const action = relayAction(args.first, args.second, args.third);
    if (action.kind === "usage") {
      refuse(USAGE);
      return;
    }
    const store = openStore();
    try {
      if (action.kind === "list") {
        const found = store.links({
          ...(action.run === undefined ? {} : { run: action.run }),
          live: !args.all,
        });
        if (args.json) write(JSON.stringify(found));
        else if (found.length === 0) write("No links.");
        else for (const one of found) write(formatLink(one));
        return;
      }
      if (action.kind === "end") {
        const ended = await unlinkNodes(store, action.a, action.b);
        if (ended.ok)
          write(`${style("green", "✓")} Ended the link. Both are told.`);
        else refuse(ended.error);
        return;
      }
      const maxMessages = maxMessagesOf(args["max-messages"]);
      if (maxMessages === null) {
        refuse("--max-messages takes a whole number above zero.");
        return;
      }
      const linked = await linkNodes(store, action.a, action.b, {
        maxMessages,
      });
      if (!linked.ok) {
        refuse(linked.error);
        return;
      }
      const [a, b] = [addressOf(linked.link.a), addressOf(linked.link.b)];
      write(
        linked.already
          ? `${a} and ${b} are already linked.`
          : `${style("green", "✓")} Linked ${a} and ${b}. Both are told at their next step.`,
      );
    } finally {
      store.close();
    }
  },
});
