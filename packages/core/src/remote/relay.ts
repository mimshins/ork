/**
 * @file A run's side of the relay (RFC-003): its nodes' links, read from the
 *   store, and sending to a node of another run. A message is a row in the
 *   store and a wake on that run's socket, so no process has to stay up for it,
 *   and the store has it if the socket is gone. Reaching a link's limit asks
 *   the user whether to go on, as a loop out of rounds does.
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import type { HumanChannel, RelayPort, SendResult } from "../runtime/types.ts";
import type { EventStore, LinkEnd, LinkRecord } from "../store/types.ts";
import { liveStatus, runTree } from "../store/view.ts";
import { flattenTree } from "./commands.ts";
import { addressOf, endLink, peerOf, tellNode } from "./links.ts";

/** For a refused or abandoned question: a stopped run has nothing to do. */
const ignore = (): void => {
  // The run is stopping.
};

export const createRelay = (options: {
  store: EventStore;
  runId: string;
  home?: string | undefined;
  human: HumanChannel;
}): RelayPort => {
  const { store, runId, home, human } = options;
  /** Links with the question about their limit open. */
  const asking = new Set<number>();

  const askToGoOn = async (link: LinkRecord, node: string): Promise<void> => {
    if (asking.has(link.id)) return;
    asking.add(link.id);
    try {
      const answer = await human.ask({
        nodeId: node,
        question: `${addressOf(link.a)} and ${addressOf(link.b)} have used all ${String(link.maxMessages)} messages of their link. Let them go on?`,
        options: [
          { id: "extend", description: `${String(link.maxMessages)} more` },
          { id: "end", description: "End the link" },
        ],
        recommended: "end",
      });
      if (answer === "extend") {
        store.extendLink(link.id, link.maxMessages);
        await Promise.all(
          [link.a, link.b].map(end =>
            tellNode(
              store,
              end,
              "[ork] The user let this link go on; you can send again.",
              home,
            ),
          ),
        );
      } else {
        await endLink(store, link, "the user ended it", home);
      }
    } finally {
      asking.delete(link.id);
    }
  };

  /** Why `peer`'s run cannot take a message now, or null. */
  const closed = (peer: LinkEnd): string | null => {
    const [run] = store.lookup(peer.run);
    if (run === undefined) return `run ${peer.run} is gone`;
    const status = liveStatus(run);
    return status === "running"
      ? null
      : `its run has finished (${status}). A finished run's session is not resumed by another agent; the user can resume it with ork chat`;
  };

  const isRunning = (peer: LinkEnd): boolean => {
    const events = store.events(peer.run).map(stored => stored.event);
    return flattenTree(runTree(events)).some(
      n => n.id === peer.node && n.state === "running",
    );
  };

  return {
    peers: node =>
      store.links({ run: runId, live: true }).flatMap(link => {
        const peer = peerOf(link, runId, node);
        return peer === undefined ? [] : [addressOf(peer)];
      }),
    send: (node, to, body): SendResult => {
      const link = store.links({ run: runId, live: true }).find(candidate => {
        const peer = peerOf(candidate, runId, node);
        return peer !== undefined && addressOf(peer) === to;
      });
      const peer = link && peerOf(link, runId, node);
      if (link === undefined || peer === undefined) {
        return { ok: false, error: `you have no live link to ${to}` };
      }
      const why = closed(peer);
      if (why !== null) {
        void endLink(store, link, why, home);
        return { ok: false, error: `${to} cannot take it: ${why}` };
      }
      if (link.messages >= link.maxMessages) {
        void askToGoOn(link, node).catch(ignore);
        return {
          ok: false,
          error: `this link has used all ${String(link.maxMessages)} of its messages, and the user has been asked whether to go on`,
        };
      }
      store.countMessage(link.id);
      store.command(peer.run, {
        kind: "relay",
        node: peer.node,
        from: `${runId}/${node}`,
        body,
      });
      void wakeRun(socketPath(peer.run, home));
      return { ok: true, delivered: isRunning(peer) ? "now" : "queued" };
    },
  };
};
