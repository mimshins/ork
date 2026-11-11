/**
 * @file Who takes a node's questions first (`questions: owner`, ADR-063): the
 *   leader that owns it, through a fork of the leader's latest session. Keeps
 *   each node's latest own session (never a fork) and where it ran, and builds
 *   the `OwnerPort` a Claude node's executor asks through.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { OwnerPort } from "../runtime/human.ts";
import type { RuntimeEvent, SessionUsage } from "../runtime/types.ts";

type Seen = NonNullable<ReturnType<OwnerPort["session"]>>;

/** The node types whose sessions can ask (`ask_user`). */
const ASKING = new Set(["agent.leader", "agent.worker"]);

export const createOwners = (graph: CompiledGraph) => {
  const sessions = new Map<string, Seen>();

  /** The leader that takes `id`'s questions first, if one does. */
  const ownerOf = (id: string, template?: string): string | undefined => {
    const node = graph.nodes.get(template ?? id)?.node;
    if (node?.parent === undefined || !ASKING.has(node.type)) return undefined;
    const owner = graph.nodes.get(node.parent)?.node;
    return owner?.type === "agent.leader" && owner.questions === "owner"
      ? node.parent
      : undefined;
  };

  return {
    /** Notes `id`'s own sessions as they start and end; forks aren't its own. */
    seen: (id: string, event: RuntimeEvent, cwd: string): void => {
      if (event.type === "session.started" && event.fork !== true) {
        sessions.set(id, {
          sessionId: event.sessionId,
          cwd: event.cwd ?? cwd,
          model: event.model,
          ...(event.driver === undefined ? {} : { driver: event.driver }),
        });
      }
      const last = sessions.get(id);
      if (
        event.type === "session.finished" &&
        event.fork !== true &&
        last !== undefined &&
        event.outcome.sessionId !== ""
      ) {
        sessions.set(id, { ...last, sessionId: event.outcome.sessionId });
      }
    },
    /**
     * The port for `id`'s questions, or `undefined` when they go straight to
     * the person. `charge` counts a fork's spend; `emit` records an event as a
     * node's.
     */
    portFor: (
      id: string,
      template: string | undefined,
      hooks: {
        budgetLeftUsd: () => number | undefined;
        charge: (owner: string, sessionId: string, usage: SessionUsage) => void;
        emit: (owner: string, event: RuntimeEvent) => void;
      },
    ): OwnerPort | undefined => {
      const owner = ownerOf(id, template);
      if (owner === undefined) return undefined;
      return {
        id: owner,
        session: () => sessions.get(owner),
        budgetLeftUsd: hooks.budgetLeftUsd,
        charge: (sessionId, usage) => {
          hooks.charge(owner, sessionId, usage);
        },
        emit: event => {
          hooks.emit(owner, event);
        },
      };
    },
  };
};
