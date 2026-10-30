/**
 * @file What a run shares between its nodes' sessions, reached through each
 *   session's ports: the message bus (`bus.ts`), claims (`claims.ts`) and the
 *   agents' feedback (`feedback/agent.ts`).
 */

import { createFeedback } from "../feedback/agent.ts";
import type { CompiledGraph } from "../graph/types.ts";
import { createBus } from "./bus.ts";
import { createClaims } from "./claims.ts";
import type { ExecuteContext, RunEvent } from "./types.ts";

export const createRunPorts = ({
  graph,
  onEvent,
}: {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
}) => {
  const bus = createBus({ graph, onEvent });
  const claims = createClaims({ graph, onEvent, notify: bus.notify });
  const feedback = createFeedback({ graph, onEvent });
  return {
    bus,
    /** One activation's ports; `template` is a spawned worker's node. */
    forNode: (
      id: string,
      template: string | undefined,
      cwd: string,
    ): Pick<ExecuteContext, "mailbox" | "claims" | "feedback"> => ({
      mailbox: bus.mailbox(id, template),
      claims: claims.port(id, template, cwd),
      feedback: feedback.port(id, template),
    }),
    /** The activation of `id` ended: its claims are released. */
    finished: (id: string): void => {
      claims.releaseAll(id);
    },
  };
};
