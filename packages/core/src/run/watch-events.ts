/**
 * @file What a `watch:` records (RFC-011): that it began, what changed, and how
 *   it ended. A look alone isn't recorded, so an hours-long wait doesn't fill
 *   the store.
 */

export type WatchEvent =
  /** A `watch:` began, and what it's waiting for (RFC-011). */
  | {
      type: "watch.started";
      id: string;
      until: string;
      every: string;
      timeout: string;
      at: string;
    }
  /** A look said something the last one didn't; a look alone isn't recorded. */
  | {
      type: "watch.changed";
      id: string;
      looks: number;
      ok: boolean;
      said: string;
      at: string;
    }
  /** How the wait ended, and how many looks it took. */
  | {
      type: "watch.ended";
      id: string;
      looks: number;
      outcome: "met" | "failed" | "timed_out" | "stopped";
    };
