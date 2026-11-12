/**
 * @file Each session's `follow_up` port inside a run: at most `FOLLOW_UP_CAP`
 *   per session, the run and node recorded as where it came from, delivered
 *   through the run's sink (the project's rule, another project, a live session
 *   there). No run event of its own: the store keeps the follow-up, the
 *   session's `tool.result` says what became of it, and a run it was relayed to
 *   records Ork's notice (`link.notice`).
 */

import type { FollowUpPort, FollowUpSink } from "./types.ts";

/** Follow-ups one session may leave. */
export const FOLLOW_UP_CAP = 30;

export const createFollowUps = ({
  runId,
  sink,
}: {
  runId: string;
  sink: FollowUpSink;
}) => ({
  /** One session's port. */
  port: (node: string, cwd: string): FollowUpPort => {
    let left = FOLLOW_UP_CAP;
    return {
      add: async input => {
        if (left === 0) {
          return {
            ok: false,
            error: `you already left ${String(FOLLOW_UP_CAP)} follow-ups in this session; put the rest in your report`,
          };
        }
        // Taken before the wait, so calls at the same time can't pass the cap.
        left -= 1;
        const result = await sink(
          { ...input, from: { run: runId, node } },
          { node, cwd },
        ).catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }));
        if (!result.ok) left += 1;
        return result;
      },
    };
  },
});
