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
  InboxMessage,
  Mailbox,
  MessageVia,
  RelayPort,
} from "../runtime/types.ts";
import { createCallRoutes } from "./bus-calls.ts";
import type { Mail, OwnerQuestion } from "./bus-events.ts";
import { createOwnerQuestions } from "./bus-questions.ts";
import { inboxNotice, notAContact, userMessageText } from "./bus-text.ts";
import { contactsOf, declaredNodes, hearsFromScripts } from "./contacts.ts";
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
  /** From a linked node or a script: as any message, a notice, then read. */
  receive: (node: string, from: string, body: string, via?: MessageVia) => void;
  /** A `notify:` of `from`'s: a message no session wrote. */
  rule: (from: string, to: string, body: string) => void;
  /** How many messages, the user's queued ones too, each node has not read. */
  unread: () => Map<string, number>;
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
  /** The user's messages for nodes not running now. */
  const waiting = new Map<string, string[]>(
    [...(mail?.waiting ?? [])].map(([id, bodies]) => [id, [...bodies]]),
  );
  let messages = mail?.last ?? 0;
  const calls = createCallRoutes(graph, relay, mail?.calls);
  const nodes = declaredNodes(graph);
  const questions = createOwnerQuestions({
    ownerOf: node => declared(node)?.node.parent,
    deliverTo: node => live.get(node),
    onEvent,
  });
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
    const { owner, children, channels } = contactsOf(
      own.id,
      nodes,
      graph.channels,
    );
    // Spawned instances share their template's owner and channels.
    const instances = [...templates]
      .filter(
        ([, template]) =>
          children.includes(template) || channels.includes(template),
      )
      .map(([instance]) => instance);
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

  /** Numbers a message and records it; returns its number. */
  const recordSent = (
    node: string,
    to: string,
    body: string,
    via?: MessageVia,
  ): number => {
    messages += 1;
    onEvent({
      type: "message.sent",
      node,
      to,
      message: messages,
      body,
      ...(via === undefined ? {} : { via }),
    });
    return messages;
  };

  /** A spawned instance has its own id, which no program or rule can name. */
  const hears = (id: string): boolean =>
    hearsFromScripts(id, nodes, graph.channels) ||
    [...graph.rules.values()].flat().some(rule => rule.to === id);

  const mailbox = (id: string, template?: string): Mailbox => {
    if (template !== undefined) templates.set(id, template);
    return {
      peers: () => peersOf(id),
      send: (to, body) => {
        const peers = peersOf(id);
        if (peers.includes(to) && calls.hold(to, id, body)) {
          return { ok: true, delivered: "queued" };
        }
        const target = calls.targetOf(to);
        if (
          target.includes("/") &&
          relay !== undefined &&
          (peers.includes(to) || peers.includes(target))
        ) {
          const sent = relay.send(id, target, body);
          if (sent.ok) recordSent(id, to, body);
          return sent;
        }
        if (!peers.includes(to)) {
          return {
            ok: false,
            error: notAContact(to, peers),
          };
        }
        inbox(to).push({ id: recordSent(id, to, body), from: id, body });
        return { ok: true, delivered: land(to) };
      },
      pending: () => inbox(id).length,
      linkable: () => relay !== undefined,
      hears: () => hears(id),
      alias: address => {
        calls.alias(id, address, {
          sent: (from, body) => recordSent(from, id, body),
          tell: (from, text) => live.get(from)?.(text),
        });
      },
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
      answer: (question, choice, note) =>
        questions.answer(id, question, choice, note),
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
          questions.ended(id);
        };
      },
    };
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
    askOwner: questions.ask,
    tell,
    notify: (node, text) => {
      live.get(node)?.(text);
      // A session waiting for a message should hear this at once too.
      waiters.get(node)?.();
    },
    receive: (node, from, body, via) => {
      messages += 1;
      const how = via === undefined ? {} : { via };
      inbox(node).push({ id: messages, from, body, ...how });
      onEvent({
        type: "message.received",
        node,
        from,
        message: messages,
        body,
        ...how,
      });
      land(node);
    },
    rule: (from, to, body) => {
      const id = recordSent(from, to, body, "rule");
      inbox(to).push({ id, from, body, via: "rule" });
      land(to);
    },
    unread: () => {
      const counts = new Map<string, number>();
      for (const [id, unread] of [...inboxes, ...waiting]) {
        counts.set(id, (counts.get(id) ?? 0) + unread.length);
      }
      return new Map([...counts].filter(([, count]) => count > 0));
    },
  };
};
