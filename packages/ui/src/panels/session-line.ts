/**
 * @file A session's own events as one line of words, for the Logs panel's rows:
 *   what the model said, the tool it called, how it ended.
 */

import type { StoredEvent } from "@krapht/ork-server/client";

type NodeEvent = Extract<StoredEvent["event"], { type: "node.event" }>;

export const oneLine = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();

const sessionLine = ({ event }: NodeEvent): string => {
  switch (event.type) {
    case "session.started": {
      return `session on ${event.model}`;
    }
    case "assistant.text": {
      return oneLine(event.text);
    }
    case "session.waiting": {
      return oneLine(event.reason);
    }
    case "tool.called": {
      return `${event.name} ${oneLine(JSON.stringify(event.input))}`;
    }
    case "tool.result": {
      return event.isError ? "tool failed" : "tool done";
    }
    case "plan.limit": {
      return event.status === "allowed"
        ? ""
        : `plan: ${event.window.replaceAll("_", " ")} limit ${event.status === "rejected" ? "reached" : "is close"}`;
    }
    case "session.finished": {
      return "session finished";
    }
    default: {
      return "";
    }
  }
};

/** A fork answering a child's question (ADR-063) says it is one. */
export const innerLine = (event: NodeEvent): string => {
  const line = sessionLine(event);
  return event.event.fork === true && line !== "" ? `fork: ${line}` : line;
};
