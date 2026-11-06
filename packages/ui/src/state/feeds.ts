/**
 * @file The runs' feeds the page holds: each run a panel looks at has one, read
 *   only while some panel retains it, since a browser gives a page few
 *   connections. A few that no panel retains stay, ready to come back to, and a
 *   resumed run's ended stream is read again.
 */

import type { Client, RunView } from "@krapht/ork-server/client";

import { createRunFeed, type RunFeed } from "./run-feed.ts";
import { createRunWatch, type RunWatch } from "./run-watch.ts";
import type { OpenSource } from "./stream-link.ts";

/** How many feeds no panel retains stay in memory, ready to come back to. */
const KEPT_FEEDS = 4;

type HeldFeed = { feed: RunFeed; retained: number };

export const isLive = (run: RunView): boolean =>
  run.live === "running" || run.live === "paused";

export const createFeeds = ({
  client,
  open,
}: {
  client: Client;
  open: OpenSource;
}) => {
  const feeds = new Map<string, HeldFeed>();

  const heldFeed = (runId: string): HeldFeed => {
    const held = feeds.get(runId) ?? {
      feed: createRunFeed({ runId, client, open }),
      retained: 0,
    };
    feeds.set(runId, held);
    return held;
  };

  /** Drops the feeds no panel retains, the longest unused first. */
  const evict = (): void => {
    const idle = [...feeds].filter(([, held]) => held.retained === 0);
    for (const [runId] of idle.slice(0, -KEPT_FEEDS)) feeds.delete(runId);
  };

  return {
    /** A resumed run's stream has ended, but the run goes on: read it again. */
    reopenResumed: (list: readonly RunView[] | null): void => {
      for (const run of list ?? []) {
        const held = feeds.get(run.id);
        if (
          held !== undefined &&
          held.retained > 0 &&
          isLive(run) &&
          held.feed.state.getValue().link === "ended"
        ) {
          held.feed.start();
        }
      }
    },
    /** A run's feed, which holds its events only while retained. */
    feedOf: (runId: string): RunFeed => heldFeed(runId).feed,
    /** Reads the run until the returned function is called. */
    retainRun: (runId: string): (() => void) => {
      const held = heldFeed(runId);
      held.retained += 1;
      held.feed.start();
      return () => {
        held.retained -= 1;
        if (held.retained === 0) {
          held.feed.stop();
          feeds.delete(runId);
          feeds.set(runId, held);
          evict();
        }
      };
    },
    /** What the Monitor shows of a run, read while it is started. */
    watchRun: (runId: string): RunWatch =>
      createRunWatch({ runId, client, feed: heldFeed(runId).feed }),
  };
};
