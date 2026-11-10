/**
 * @file What the Logs panel works out from a run's events: the node each is
 *   about, a line in words, the filters, and the command that shows the same.
 */

import type { StoredEvent } from "@krapht/ork-server/client";

type Event = StoredEvent["event"];
type Of<T extends Event["type"]> = Extract<Event, { type: T }>;

/** The node an event is about, if it is about one. */
export const nodeOf = (event: Event): string | undefined => {
  if ("id" in event) return event.id;
  if ("node" in event) return event.node;
  return "from" in event ? event.from : undefined;
};

const oneLine = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

/** How a message came, when no session wrote it. */
const viaOf = (via: string | undefined): string =>
  via === undefined ? "" : ` (${via})`;

const sessionLine = ({ event }: Of<"node.event">): string => {
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
const innerLine = (event: Of<"node.event">): string => {
  const line = sessionLine(event);
  return event.event.fork === true && line !== "" ? `fork: ${line}` : line;
};

const finishedLine = ({
  ok,
  error,
  round,
  output,
}: Of<"node.finished">): string => {
  const { summary } = output;
  const said = typeof summary === "string" ? `: ${oneLine(summary)}` : "";
  const word = ok
    ? `ok${said}`
    : `failed${error === undefined ? "" : `: ${oneLine(error)}`}`;
  return round > 1 ? `round ${String(round)}: ${word}` : word;
};

/** The event in a line; empty when its type says it all. */
export const lineOf = (event: Event): string => {
  switch (event.type) {
    case "run.started": {
      return `${event.workflow}, ${String(event.nodes.length)} nodes`;
    }
    case "run.resumed": {
      return `keeps ${String(event.kept.length)} nodes`;
    }
    case "run.command": {
      return event.node === undefined
        ? event.command
        : `${event.command} ${event.node}`;
    }
    case "run.finished": {
      return event.result.status;
    }
    case "node.started": {
      return event.round > 1
        ? `${event.nodeType}, round ${String(event.round)}`
        : event.nodeType;
    }
    case "node.event": {
      return innerLine(event);
    }
    case "node.finished": {
      return finishedLine(event);
    }
    case "each.listed": {
      return `${String(event.count)} items`;
    }
    case "each.exceeded": {
      return `${String(event.count)} items, over ${String(event.maxItems)}`;
    }
    case "edge.taken": {
      return `${event.from} -> ${event.to}`;
    }
    case "loop.exhausted": {
      return `${event.from} -> ${event.to} after ${String(event.maxRounds)} rounds`;
    }
    case "watch.started": {
      return `until ${event.until}, every ${event.every}`;
    }
    case "watch.changed": {
      return `look ${String(event.looks)}: ${event.said}`;
    }
    case "watch.ended": {
      return `${event.outcome} after ${String(event.looks)} looks`;
    }
    case "worktree": {
      return `${event.action} ${event.branch ?? event.path}`;
    }
    case "decision.opened": {
      return oneLine(event.question);
    }
    case "decision.answered": {
      const said =
        event.note === undefined ? "" : `; said: ${oneLine(event.note)}`;
      return `${event.answer}, by ${event.by}${said}`;
    }
    case "message.sent": {
      return `to ${event.to}${viaOf(event.via)}: ${oneLine(event.body)}`;
    }
    case "message.received": {
      return `from ${event.from}${viaOf(event.via)}: ${oneLine(event.body)}`;
    }
    case "call.started": {
      return `${event.workflow} as ${event.run}`;
    }
    case "link.notice": {
      return oneLine(event.text);
    }
    case "owner.asked": {
      return `about ${event.about}: ${oneLine(event.text)}`;
    }
    case "owner.answered": {
      return event.answer;
    }
    case "user.message": {
      return `${event.delivered}: ${oneLine(event.body)}`;
    }
    case "claim.taken": {
      return event.resource;
    }
    case "claim.refused": {
      return `${event.resource}: ${event.holder} holds ${event.held}`;
    }
    case "claim.released": {
      return `${event.resource}, ${event.reason}`;
    }
    case "feedback.recorded": {
      return oneLine(event.feedback.title);
    }
    case "message.read": {
      return `${String(event.ids.length)} messages`;
    }
    case "decision.withdrawn":
    case "node.held":
    case "node.released":
    case "node.skipped":
    case "owner.unanswered": {
      return "";
    }
    default: {
      // From a newer engine than this page.
      return "";
    }
  }
};

/** What the text filter looks through, kept since events do not change. */
const searched = new WeakMap<StoredEvent, string>();

const searchTextOf = (stored: StoredEvent): string => {
  const known = searched.get(stored);
  if (known !== undefined) return known;
  const text = JSON.stringify(stored.event).toLowerCase();
  searched.set(stored, text);
  return text;
};

export type LogFilters = {
  node: string | null;
  type: string | null;
  text: string;
};

export const NO_FILTERS: LogFilters = { node: null, type: null, text: "" };

/** An item of a fanned node: `build.2`, but not `build.x` or `builder`. */
const itemOf = (id: string): string | undefined => /^(.+)\.\d+$/u.exec(id)?.[1];

/** Whether an event's node is the filter's: a node's items go with it. */
const isOfNode = (id: string | undefined, filter: string): boolean =>
  id !== undefined && (id === filter || itemOf(id) === filter);

export const filterEvents = (
  events: readonly StoredEvent[],
  { node, type, text }: LogFilters,
): readonly StoredEvent[] => {
  const words = text.trim().toLowerCase();
  if (node === null && type === null && words === "") return events;
  return events.filter(
    stored =>
      (node === null || isOfNode(nodeOf(stored.event), node)) &&
      (type === null || stored.event.type === type) &&
      (words === "" || searchTextOf(stored).includes(words)),
  );
};

/** Sorted so that `build.2` comes before `build.10`. */
const sortedUnique = (values: Iterable<string>): string[] =>
  [...new Set(values)].toSorted((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

/** What the node filter's option for a node reads. */
export const nodeOption = (
  id: string,
  ids: readonly string[],
): { value: string; label: string } => ({
  value: id,
  label: ids.some(other => itemOf(other) === id) ? `${id} and its items` : id,
});

/** The nodes to filter by: those in view, and the one selected if it is not. */
export const nodesIn = (
  events: readonly StoredEvent[],
  selected: string | null,
): string[] =>
  sortedUnique([
    ...events.flatMap(({ event }) => nodeOf(event) ?? []),
    ...(selected === null ? [] : [selected]),
  ]);

export const typesIn = (events: readonly StoredEvent[]): string[] =>
  sortedUnique(events.map(({ event }) => event.type));

/** The CLI twin of what is shown. */
/** How much of the run is loaded and how much of that the filters leave. */
export const countsLine = (
  shown: number,
  loaded: number,
  latest: number,
): string =>
  `${
    shown === loaded
      ? `${String(shown)} events`
      : `${String(shown)} of ${String(loaded)} loaded`
  }${latest > loaded ? `, ${String(latest)} in the run` : ""}`;

export const logsCommand = (runId: string, node: string | null): string =>
  `ork logs ${runId}${node === null ? "" : ` --node ${node}`} --follow`;

export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
