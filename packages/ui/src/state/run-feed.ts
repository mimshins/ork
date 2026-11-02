/**
 * @file One run's events in a container: the newest page first, then its stream
 *   from there, and older or newer pages on request. Frames are gathered and
 *   written together, so a burst is one change and not one render per event.
 *   After a dropped stream the next one starts after the last event seen, and
 *   the store is the truth: nothing here is written but what the server sent.
 */

import {
  type Client,
  fillPath,
  type RunStreamEvents,
  type StoredEvent,
  STREAMS,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import {
  EMPTY_WINDOW,
  type EventWindow,
  hasNewer,
  hasOlder,
  lastOf,
  olderPage,
  PAGE_SIZE,
  withLive,
  withNewer,
  withOlder,
  withTail,
} from "./event-window.ts";
import { type OpenSource, openLink, type StreamLink } from "./stream-link.ts";

export type FeedLink = "idle" | "loading" | "live" | "lost" | "ended";

export type RunEvents = EventWindow & {
  link: FeedLink;
  /** Why its stream ended, once it has. */
  ended: RunStreamEvents["end"]["reason"] | null;
  /** A page is being read. */
  paging: boolean;
  /** Why the last read failed. */
  error: string | null;
};

export type RunFeed = ReturnType<typeof createRunFeed>;

export type RunFeedOptions = {
  runId: string;
  client: Client;
  open: OpenSource;
};

/** How long frames gather before they are written. */
export const FLUSH_MS = 50;
const RELOAD_MS = 1000;

export const createRunFeed = ({ runId, client, open }: RunFeedOptions) => {
  const state = Container.create<RunEvents>({
    ...EMPTY_WINDOW,
    link: "idle",
    ended: null,
    paging: false,
    error: null,
  });
  let link: StreamLink | null = null;
  let loaded = false;
  let running = false;
  /** Counts starts and stops: a read from before one has nothing to start. */
  let session = 0;
  let pending: StoredEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const change = (next: Partial<RunEvents>): void => {
    void state.setValue({ ...state.getValue(), ...next });
  };

  /** The newest seq received, written yet or not. */
  const seen = (): number => pending.at(-1)?.seq ?? state.getValue().latest;

  const read = async (
    query: { after?: number; limit?: number; last?: number },
    apply: (window: EventWindow, page: readonly StoredEvent[]) => EventWindow,
  ): Promise<boolean> => {
    change({ paging: true });
    const answer = await client.call("events", {
      params: { id: runId },
      query,
    });
    if (!answer.ok) {
      change({ paging: false, error: answer.error });
      return false;
    }
    change({
      ...apply(state.getValue(), answer.data),
      paging: false,
      error: null,
    });
    return true;
  };

  /** Following, but behind: frames came while a page was being read. */
  const catchUp = async (): Promise<void> => {
    const window = state.getValue();
    if (window.following && hasNewer(window) && !window.paging) {
      const done = await read(
        { after: lastOf(window), limit: PAGE_SIZE },
        withNewer,
      );
      if (done) await catchUp();
    }
  };

  const flush = (): void => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    change(withLive(state.getValue(), batch));
    void catchUp();
  };

  const closeLink = (): void => {
    link?.close();
    link = null;
  };

  const connect = (): void => {
    link = openLink<RunStreamEvents>({
      url: () =>
        `${fillPath(STREAMS.run, { id: runId })}?after=${String(seen())}`,
      open,
      on: {
        "run-event": stored => {
          if (stored.seq <= seen()) return;
          pending.push(stored);
          flushTimer ??= setTimeout(flush, FLUSH_MS);
        },
        end: ({ reason }) => {
          flush();
          closeLink();
          running = false;
          change({ link: "ended", ended: reason });
        },
      },
      onStatus: status => {
        change({
          link:
            status === "open" ? "live" : status === "lost" ? "lost" : "loading",
        });
      },
    });
  };

  const load = async (): Promise<void> => {
    const mine = session;
    change({ link: "loading" });
    const done = await read({ last: PAGE_SIZE }, withTail);
    if (mine !== session) return;
    if (done) {
      loaded = true;
      connect();
    } else {
      change({ link: "lost" });
      reloadTimer = setTimeout(() => void load(), RELOAD_MS);
    }
  };

  return {
    state,
    /** Starts reading, or starts again after a stop or the stream's end. */
    start: (): void => {
      if (running) return;
      running = true;
      session += 1;
      change({ ended: null });
      if (loaded) connect();
      else void load();
    },
    stop: (): void => {
      running = false;
      session += 1;
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      reloadTimer = null;
      flush();
      closeLink();
      if (state.getValue().link !== "ended") change({ link: "idle" });
    },
    loadOlder: async (): Promise<void> => {
      const window = state.getValue();
      if (hasOlder(window) && !window.paging) {
        await read(olderPage(window), withOlder);
      }
    },
    loadNewer: async (): Promise<void> => {
      const window = state.getValue();
      if (hasNewer(window) && !window.paging) {
        await read({ after: lastOf(window), limit: PAGE_SIZE }, withNewer);
      }
    },
    /** New events stop joining the window, so what is read holds still. */
    hold: (): void => {
      change({ following: false });
    },
    /** Back to the newest, and new events join again. */
    follow: async (): Promise<void> => {
      const window = state.getValue();
      if (window.paging) return;
      if (hasNewer(window)) await read({ last: PAGE_SIZE }, withTail);
      else change({ following: true });
      await catchUp();
    },
  };
};
