/**
 * @file What the Chats panel works out from a run's events: which nodes have
 *   sessions to talk to, one node's thread, and whether it can be written to
 *   now.
 */

import type { RunView, StoredEvent } from "@krapht/ork-server/client";

const SESSION_TYPES: ReadonlySet<string> = new Set([
  "agent.leader",
  "agent.worker",
]);

/** The leaders and workers: declared by the run, or seen starting. */
export const sessionNodes = (events: readonly StoredEvent[]): string[] => {
  const nodes = new Set<string>();
  for (const { event } of events) {
    if (event.type === "run.started") {
      for (const { id, type } of event.nodes) {
        if (SESSION_TYPES.has(type)) nodes.add(id);
      }
    } else if (
      event.type === "node.started" &&
      SESSION_TYPES.has(event.nodeType)
    ) {
      nodes.add(event.id);
    }
  }
  return [...nodes];
};

export type ThreadItem = {
  /** The event it comes from, which also keeps the order. */
  seq: number;
  at: string;
  /** `you` and `node` are the conversation; the rest is what happened around it. */
  kind: "you" | "node" | "peer" | "activity";
  /** Who said it, when it is not plain from `kind`. */
  from?: string;
  text: string;
  /** More about it: how a message of yours was delivered. */
  note?: string;
};

const DELIVERED = {
  now: "delivered to its session",
  queued: "waits for its next session",
  resumed: "resumed its session",
} as const;

/** What a message says of itself when no session wrote it. */
const viaNote = (via: "script" | "rule" | undefined): { note?: string } =>
  via === undefined ? {} : { note: via === "script" ? "a script" : "a rule" };

/** Ork's own tools, by the names the node knows them by. */
const ORK_TOOL = /^mcp__ork__/u;
/** How a report is sent: the report itself shows next. */
const HIDDEN_TOOLS: ReadonlySet<string> = new Set(["StructuredOutput"]);

/** What a node's own session did, as its thread says it. */
const sessionItem = (
  inner: Extract<StoredEvent["event"], { type: "node.event" }>["event"],
  base: Pick<ThreadItem, "seq" | "at">,
): ThreadItem | undefined => {
  if (inner.type === "assistant.text") {
    return { ...base, kind: "node", text: inner.text };
  }
  if (inner.type === "tool.called") {
    return HIDDEN_TOOLS.has(inner.name)
      ? undefined
      : {
          ...base,
          kind: "activity",
          text: `Used ${inner.name.replace(ORK_TOOL, "")}`,
        };
  }
  return inner.type === "session.started"
    ? { ...base, kind: "activity", text: `Session on ${inner.model}` }
    : undefined;
};

/** What an event says in this node's thread, if anything. */
const itemOf = (
  { seq, at, event }: StoredEvent,
  node: string,
): ThreadItem | undefined => {
  const base = { seq, at };
  const activity = (text: string): ThreadItem => ({
    ...base,
    kind: "activity",
    text,
  });
  if (event.type === "node.event") {
    if (event.id !== node) return undefined;
    // A fork answering a child's question (ADR-063) isn't the node talking:
    // one line says it ran, and the decision says what it chose.
    if (event.event.fork === true) {
      return event.event.type === "session.started"
        ? activity("A fork took a child's question")
        : undefined;
    }
    return sessionItem(event.event, base);
  }
  if (event.type === "node.finished") {
    if (event.id !== node) return undefined;
    const { summary } = event.output;
    // A node's last word is usually its report, not a message.
    if (event.ok && typeof summary === "string") {
      return { ...base, kind: "node", text: summary, note: "its report" };
    }
    const reason = event.error === undefined ? "" : `: ${event.error}`;
    return activity(event.ok ? "Finished." : `Failed${reason}`);
  }
  if (event.type === "message.sent" && event.to === node) {
    return {
      ...base,
      kind: "peer",
      from: event.node,
      text: event.body,
      ...viaNote(event.via),
    };
  }
  if (!("node" in event) || event.node !== node) return undefined;
  if (event.type === "user.message") {
    return {
      ...base,
      kind: "you",
      text: event.body,
      note: DELIVERED[event.delivered],
    };
  }
  if (event.type === "message.sent") {
    return activity(
      event.via === "rule"
        ? `A rule wrote to ${event.to}: ${event.body}`
        : `Wrote to ${event.to}: ${event.body}`,
    );
  }
  if (event.type === "message.received") {
    return {
      ...base,
      kind: "peer",
      from: event.from,
      text: event.body,
      ...viaNote(event.via),
    };
  }
  if (event.type === "decision.opened") {
    return activity(`Asked you: ${event.question}`);
  }
  if (event.type !== "decision.answered") return undefined;
  return activity(
    event.note === undefined
      ? `You answered: ${event.answer}`
      : `You answered: ${event.answer}. You said: ${event.note}`,
  );
};

export const threadOf = (
  events: readonly StoredEvent[],
  node: string,
): ThreadItem[] => events.flatMap(stored => itemOf(stored, node) ?? []);

/** Why it cannot be written to now, or null when it can. */
export const whyNoSend = ({ live }: Pick<RunView, "live">): string | null => {
  if (live === "running") return null;
  return live === "paused"
    ? "The run is paused. Continue it to write to this node."
    : `The run has ended (${live}). To resume this node's session, use:`;
};

export const chatCommand = (runId: string, node: string): string =>
  `ork chat ${runId} ${node}`;
