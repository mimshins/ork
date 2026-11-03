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
  RelayPort,
} from "../runtime/types.ts";
import type { Mail, OwnerQuestion } from "./bus-events.ts";
import { inboxNotice, ownerQuestionText, userMessageText } from "./bus-text.ts";
import type { Slots } from "./slots.ts";
import type { RunEvent } from "./types.ts";

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
  /** Pushes Ork's own line into the node's live session; dropped otherwise. */
  notify: (node: string, text: string) => void;
  /** A message from a linked node of another run: as any, a notice, then read. */
  receive: (node: string, from: string, body: string) => void;
};

type Open = {
  owner: string;
  options: DecisionChoice[];
  resolve: (answer: string | null) => void;
};

const SESSION_TYPES = new Set(["claude.leader", "claude.worker"]);

export const createBus = ({
  graph,
  onEvent,
  mail,
  relay,
  slots,
}: {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
  mail?: Mail | undefined;
  /** How to reach nodes of other runs; none when links are off. */
  relay?: RelayPort | undefined;
  /** What a session waiting for a message gives its slot back to. */
  slots?: Pick<Slots, "release" | "take"> | undefined;
}): Bus => {
  /** Spawned instance -> the declared node it is an instance of. */
  const templates = new Map<string, string>();
  const inboxes = new Map<string, InboxMessage[]>(
    [...(mail?.inboxes ?? [])].map(([id, unread]) => [id, [...unread]]),
  );
  const live = new Map<string, (text: string) => void>();
  const open = new Map<string, Open>();
  /** The user's messages for nodes not running now. */
  const waiting = new Map<string, string[]>(
    [...(mail?.waiting ?? [])].map(([id, bodies]) => [id, [...bodies]]),
  );
  let messages = mail?.last ?? 0;
  let questions = 0;
  /** Sessions in `wait`: called when a message arrives or the session ends. */
  const waiters = new Map<string, () => void>();

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
        ...(relay?.peers(id) ?? []),
      ]),
    ].filter(peer => peer !== id);
  };

  /** Puts a message in `to`'s inbox, and tells its session if it is live. */
  const land = (to: string): "now" | "queued" => {
    const deliver = live.get(to);
    deliver?.(inboxNotice(inbox(to)));
    waiters.get(to)?.();
    return deliver === undefined ? "queued" : "now";
  };

  const mailbox = (id: string, template?: string): Mailbox => {
    if (template !== undefined) templates.set(id, template);
    return {
      peers: () => peersOf(id),
      send: (to, body) => {
        const peers = peersOf(id);
        if (to.includes("/") && relay !== undefined && peers.includes(to)) {
          const sent = relay.send(id, to, body);
          if (sent.ok) {
            messages += 1;
            onEvent({
              type: "message.sent",
              node: id,
              to,
              message: messages,
              body,
            });
          }
          return sent;
        }
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
        return { ok: true, delivered: land(to) };
      },
      pending: () => inbox(id).length,
      linkable: () => relay !== undefined,
      wait: async ms => {
        if (inbox(id).length > 0 || !live.has(id)) return;
        const { promise, resolve } = Promise.withResolvers<void>();
        const timer = setTimeout(resolve, ms);
        waiters.set(id, resolve);
        slots?.release();
        try {
          await promise;
        } finally {
          clearTimeout(timer);
          waiters.delete(id);
          await slots?.take();
        }
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
          waiters.get(id)?.();
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

  return {
    mailbox,
    askOwner,
    tell,
    notify: (node, text) => {
      live.get(node)?.(text);
    },
    receive: (node, from, body) => {
      messages += 1;
      inbox(node).push({ id: messages, from, body });
      onEvent({
        type: "message.received",
        node,
        from,
        message: messages,
        body,
      });
      land(node);
    },
  };
};
