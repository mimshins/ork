/**
 * @file Who a node may write to on the run's bus, as pure functions of its
 *   declared nodes and channels, so that the bus and `ork send` cannot
 *   disagree. A session writes to its owner, the sessions it owns and its
 *   channels. A program in a tool node writes to its owner and its channels,
 *   one way: it has no session to write back to, so no session lists it.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { RunNodeInfo } from "./types.ts";

const SESSION_TYPES = new Set(["agent.leader", "agent.worker"]);

type Channels = readonly (readonly [string, string])[];

const isSession = (node: RunNodeInfo | undefined): boolean =>
  SESSION_TYPES.has(node?.type ?? "");

const isTool = (node: RunNodeInfo | undefined): boolean =>
  node?.type.startsWith("tool.") ?? false;

const channelPeersOf = (id: string, channels: Channels): string[] =>
  channels.flatMap(([a, b]) => {
    if (a === id) return [b];
    return b === id ? [a] : [];
  });

/** Every declared node, with its owner, as a run records them. */
export const declaredNodes = (graph: CompiledGraph): RunNodeInfo[] =>
  [...graph.nodes.values()].map(({ id, node }) =>
    node.parent === undefined
      ? { id, type: node.type }
      : { id, type: node.type, parent: node.parent },
  );

/** Whom a session may write to, by how it knows them. */
export const contactsOf = (
  id: string,
  nodes: readonly RunNodeInfo[],
  channels: Channels,
): { owner: string | undefined; children: string[]; channels: string[] } => {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return {
    owner: byId.get(id)?.parent,
    children: nodes
      .filter(node => node.parent === id && isSession(node))
      .map(node => node.id),
    channels: channelPeersOf(id, channels).filter(
      peer => !isTool(byId.get(peer)),
    ),
  };
};

/** Whom a program in the tool node `id` may write to. */
export const scriptContactsOf = (
  id: string,
  nodes: readonly RunNodeInfo[],
  channels: Channels,
): string[] => {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const owner = byId.get(id)?.parent;
  return [
    ...new Set([
      ...(owner !== undefined && isSession(byId.get(owner)) ? [owner] : []),
      ...channelPeersOf(id, channels).filter(peer => isSession(byId.get(peer))),
    ]),
  ];
};

/** Whether a program in a tool node may write to the session `id`. */
export const hearsFromScripts = (
  id: string,
  nodes: readonly RunNodeInfo[],
  channels: Channels,
): boolean =>
  nodes.some(
    node =>
      isTool(node) && scriptContactsOf(node.id, nodes, channels).includes(id),
  );
