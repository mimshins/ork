/**
 * @file How the bus reaches a `workflow.call` node (RFC-004): agents write to
 *   the call by name, and once its run has started that name stands for the
 *   called node's address. A message sent before then waits for it. A resumed
 *   caller remembers what its calls started, so a message to one that goes
 *   unactivated is refused for having no link, rather than waiting for ever.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { RelayPort } from "../runtime/types.ts";

export type CallRoutes = {
  /** Keeps a message to a call that has not started; false if not such a call. */
  hold: (to: string, from: string, body: string) => boolean;
  /** The address `to` stands for, or `to`. */
  targetOf: (to: string) => string;
  /** The call has started: sends what waited, and tells those it fails for. */
  alias: (
    call: string,
    address: string,
    effects: {
      sent: (from: string, body: string) => unknown;
      tell: (from: string, text: string) => unknown;
    },
  ) => void;
};

export const createCallRoutes = (
  graph: CompiledGraph,
  relay: RelayPort | undefined,
  /** Call node -> the run it started, from a resumed run's events. */
  started?: ReadonlyMap<string, string>,
): CallRoutes => {
  const aliases = new Map<string, string>(
    [...(started ?? [])].flatMap(([call, run]) => {
      const node = graph.nodes.get(call)?.node;
      return node?.type === "workflow.call" && node.node !== undefined
        ? [[call, `${run}/${node.node}`] as const]
        : [];
    }),
  );
  const held = new Map<string, { from: string; body: string }[]>();
  return {
    hold: (to, from, body) => {
      if (graph.nodes.get(to)?.node.type !== "workflow.call") return false;
      if (aliases.has(to)) return false;
      held.set(to, [...(held.get(to) ?? []), { from, body }]);
      return true;
    },
    targetOf: to => aliases.get(to) ?? to,
    alias: (call, address, { sent, tell }) => {
      aliases.set(call, address);
      for (const { from, body } of held.get(call) ?? []) {
        const result = relay?.send(from, address, body);
        if (result?.ok === true) sent(from, body);
        else {
          tell(
            from,
            `[ork] Your message to ${call} was not sent: ${result?.error ?? "links are off"}.`,
          );
        }
      }
      held.delete(call);
    },
  };
};
