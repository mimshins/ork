/**
 * @file How the message bus's and claims' run events read in a terminal: a
 *   message's first line, a claim, a question to an owner, a link.
 */

import type { RunEvent } from "@krapht/ork-core";

import { style } from "../output.ts";

/** The first line of a message body, cut to fit one terminal line. */
export const firstLine = (body: string): string => {
  const [line = ""] = body.trim().split("\n");
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};

/** Messages, owner questions and claims, without the node prefix. */
export const formatBusEvent = (
  event: Extract<
    RunEvent,
    | { type: `message.${string}` }
    | { type: `owner.${string}` }
    | { type: `claim.${string}` }
    | { type: `link.${string}` }
  >,
): string[] => {
  if (event.type === "claim.taken") {
    return [style("dim", `⚑ claimed ${event.resource}`)];
  }
  if (event.type === "claim.refused") {
    const held =
      event.held === event.resource ? "" : ` (it holds ${event.held})`;
    return [style("yellow", `⚑ ${event.resource} is ${event.holder}'s${held}`)];
  }
  if (event.type === "claim.released") {
    return [style("dim", `⚑ released ${event.resource}`)];
  }
  if (event.type === "message.sent") {
    return [style("dim", `✉ to ${event.to}: ${firstLine(event.body)}`)];
  }
  if (event.type === "message.received") {
    return [style("dim", `✉ from ${event.from}: ${firstLine(event.body)}`)];
  }
  if (event.type === "link.notice") return [style("dim", `↔ ${event.text}`)];
  if (event.type === "message.read") return [];
  if (event.type === "owner.asked") {
    return [
      `${style(["yellow", "bold"], "?")} asked as the owner of ${event.about}: ${event.text} ${style("dim", `(${event.question})`)}`,
    ];
  }
  if (event.type === "owner.answered") {
    return [style("dim", `→ ${event.answer} (owner)`)];
  }
  return [style("dim", "→ its session ended first; asking you")];
};
