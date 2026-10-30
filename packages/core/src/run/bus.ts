/**
 * @file The run's message bus (`specs/messaging.md`): nodes with sessions write
 *   to their owner, their children and their declared channels; each message
 *   lands in the recipient's inbox, a live session gets a one-line notice, and
 *   the bodies are pulled with `read_inbox`. The bus also asks a live owner
 *   about a node it owns (a loop out of rounds) before the human, and carries
 *   the user's own messages (`ork chat`), pushed in full.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type {
  DecisionChoice,
  InboxMessage,
  Mailbox,
} from "../runtime/types.ts";
import type { RunEvent } from "./types.ts";

/** A question Ork asks a node's owner. */
export type OwnerQuestion = {
  question: string;
  options: DecisionChoice[];
  recommended?: string;
  context?: string;
};

export type Bus = {
  /** `template` is the declared node a spawned worker is an instance of. */
  mailbox: (id: string, template?: string) => Mailbox;
  /**
   * Asks the owner of `node` while its session is live: its answer, or `null`
   * when it has no owner, the owner's session is not live, or it ends first.
   */
  askOwner: (node: string, question: OwnerQuestion) => Promise<string | null>;
  /**
   * A message from the user, pushed in full: into the node's live session now,
   * or into its next one. `null` when the node has no session.
   */
  tell: (node: string, body: string) => "now" | "queued" | null;
};

type Open = {
  owner: string;
  options: DecisionChoice[];
  resolve: (answer: string | null) => void;
};

const SESSION_TYPES = new Set(["claude.leader", "claude.worker"]);

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

export const createBus = ({
  graph,
  onEvent,
}: {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
}): Bus => {
  /** Spawned instance -> the declared node it is an instance of. */
  const templates = new Map<string, string>();
  const inboxes = new Map<string, InboxMessage[]>();
  const live = new Map<string, (text: string) => void>();
  const open = new Map<string, Open>();
  /** The user's messages for nodes not running now. */
  const waiting = new Map<string, string[]>();
  let messages = 0;
  let questions = 0;

  const declared = (id: string) => graph.nodes.get(templates.get(id) ?? id);
  const hasSession = (id: string) =>
    SESSION_TYPES.has(graph.nodes.get(id)?.node.type ?? "");
  const inbox = (id: string): InboxMessage[] => {
    const existing = inboxes.get(id);
    if (existing !== undefined) return existing;
    const created: InboxMessage[] = [];
    inboxes.set(id, created);
    return created;
  };

  const peersOf = (id: string): string[] => {
    const own = declared(id);
    if (own === undefined) return [];
    const children = own.children.filter(hasSession);
    const channels = graph.channels.flatMap(([a, b]) => {
      if (a === own.id) return [b];
      return b === own.id ? [a] : [];
    });
    // Spawned instances share their template's owner and channels.
    const instances = [...templates]
      .filter(
        ([, template]) =>
          children.includes(template) || channels.includes(template),
      )
      .map(([instance]) => instance);
    const owner = own.node.parent;
    return [
      ...new Set([
        ...(owner === undefined ? [] : [owner]),
        ...children,
        ...instances,
        ...channels,
      ]),
    ].filter(peer => peer !== id);
  };

  const mailbox = (id: string, template?: string): Mailbox => {
    if (template !== undefined) templates.set(id, template);
    return {
      peers: () => peersOf(id),
      send: (to, body) => {
        const peers = peersOf(id);
        if (!peers.includes(to)) {
          return {
            ok: false,
            error:
              peers.length === 0
                ? "you have no one to message in this run"
                : `"${to}" is not one of your contacts; you can message ${peers.join(", ")} (your owner, the nodes you own, and your declared channels)`,
          };
        }
        messages += 1;
        inbox(to).push({ id: messages, from: id, body });
        onEvent({
          type: "message.sent",
          node: id,
          to,
          message: messages,
          body,
        });
        const deliver = live.get(to);
        deliver?.(inboxNotice(inbox(to)));
        return {
          ok: true,
          delivered: deliver === undefined ? "queued" : "now",
        };
      },
      read: () => {
        const unread = inbox(id).splice(0);
        if (unread.length > 0) {
          onEvent({
            type: "message.read",
            node: id,
            ids: unread.map(m => m.id),
          });
        }
        return unread;
      },
      answer: (question, choice) => {
        const asked = open.get(question);
        if (asked?.owner !== id) {
          return { ok: false, error: `no open question ${question} for you` };
        }
        if (!asked.options.some(o => o.id === choice)) {
          return {
            ok: false,
            error: `"${choice}" is not an option: ${asked.options.map(o => o.id).join(", ")}`,
          };
        }
        open.delete(question);
        onEvent({ type: "owner.answered", node: id, question, answer: choice });
        asked.resolve(choice);
        return { ok: true };
      },
      connect: deliver => {
        live.set(id, deliver);
        for (const body of waiting.get(id) ?? []) {
          deliver(userMessageText(body));
        }
        waiting.delete(id);
        const unread = inbox(id);
        if (unread.length > 0) deliver(inboxNotice(unread));
        return () => {
          if (live.get(id) === deliver) live.delete(id);
          for (const [question, asked] of open) {
            if (asked.owner !== id) continue;
            open.delete(question);
            onEvent({ type: "owner.unanswered", node: id, question });
            asked.resolve(null);
          }
        };
      },
    };
  };

  const askOwner: Bus["askOwner"] = (node, question) => {
    const owner = declared(node)?.node.parent;
    const deliver = owner === undefined ? undefined : live.get(owner);
    if (owner === undefined || deliver === undefined) {
      return Promise.resolve(null);
    }
    questions += 1;
    const id = `q${String(questions)}`;
    const { promise, resolve } = Promise.withResolvers<string | null>();
    open.set(id, { owner, options: question.options, resolve });
    const asked: RunEvent = {
      type: "owner.asked",
      node: owner,
      about: node,
      question: id,
      text: question.question,
      options: question.options,
    };
    if (question.recommended !== undefined) {
      asked.recommended = question.recommended;
    }
    onEvent(asked);
    deliver(ownerQuestionText(id, node, question));
    return promise;
  };

  const tell: Bus["tell"] = (node, body) => {
    if (!hasSession(declared(node)?.id ?? "")) return null;
    const deliver = live.get(node);
    if (deliver === undefined) {
      waiting.set(node, [...(waiting.get(node) ?? []), body]);
    } else deliver(userMessageText(body));
    const delivered = deliver === undefined ? "queued" : "now";
    onEvent({ type: "user.message", node, body, delivered });
    return delivered;
  };

  return { mailbox, askOwner, tell };
};
