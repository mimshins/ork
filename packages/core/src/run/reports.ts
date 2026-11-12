/**
 * @file What a session leaves beside its result, per session: feedback about
 *   the process (`feedback/agent.ts`) and follow-ups about the product
 *   (`follow-ups/session.ts`), the latter only when the run keeps them.
 */

import { createFeedback } from "../feedback/agent.ts";
import { createFollowUps } from "../follow-ups/session.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { FollowUpSink } from "../runtime/types.ts";
import type { ExecuteContext, RunEvent } from "./types.ts";

export const createSessionReports = ({
  graph,
  runId,
  sink,
  onEvent,
}: {
  graph: CompiledGraph;
  runId: string;
  sink: FollowUpSink | undefined;
  onEvent: (event: RunEvent) => void;
}) => {
  const feedback = createFeedback({ graph, onEvent });
  const followUps =
    sink === undefined ? undefined : createFollowUps({ runId, sink });
  return {
    /** One session's ports; `template` is a spawned worker's node. */
    port: (
      id: string,
      template: string | undefined,
      cwd: string,
    ): Pick<ExecuteContext, "feedback" | "followUps"> => ({
      feedback: feedback.port(id, template),
      ...(followUps === undefined
        ? {}
        : { followUps: followUps.port(id, cwd) }),
    }),
  };
};
