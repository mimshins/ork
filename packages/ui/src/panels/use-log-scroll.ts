/**
 * @file The Logs list's scrolling: it stays on the newest while following, and
 *   scrolling up holds the feed so what is being read stays still; back at the
 *   end, it follows again. Older events added above keep what is on screen
 *   where it is. A panel shown again or resized goes back to the end if it was
 *   there, since a hidden panel's list forgets where it was scrolled.
 */

import { useEffect, useLayoutEffect, useRef } from "react";

import { hasNewer } from "../state/event-window.ts";
import type { RunEvents, RunFeed } from "../state/run-feed.ts";

/** How near the end counts as at it, for a wheel that stops a little short. */
const NEAR_END = 32;

const isAtEnd = (list: HTMLElement): boolean =>
  list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_END;

export const useLogScroll = (feed: RunFeed, events: RunEvents) => {
  const listRef = useRef<HTMLOListElement>(null);
  const { following } = events;
  const firstSeq = events.events[0]?.seq;
  const before = useRef({ firstSeq, height: 0 });

  // After every render: filters and new events both change what is drawn.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    if (following) {
      list.scrollTop = list.scrollHeight;
    } else if (
      before.current.firstSeq !== firstSeq &&
      before.current.height > 0
    ) {
      list.scrollTop += list.scrollHeight - before.current.height;
    }
    before.current = { firstSeq, height: list.scrollHeight };
  });

  useEffect(() => {
    const list = listRef.current;
    const observer = new ResizeObserver(() => {
      if (list !== null && feed.state.getValue().following) {
        list.scrollTop = list.scrollHeight;
      }
    });
    if (list !== null) observer.observe(list);
    return () => {
      observer.disconnect();
    };
  });

  const onScroll = (): void => {
    const list = listRef.current;
    if (list === null) return;
    const atEnd = isAtEnd(list);
    const current = feed.state.getValue();
    if (current.following && !atEnd) feed.hold();
    else if (!current.following && atEnd && !hasNewer(current)) {
      void feed.follow();
    }
  };

  return { listRef, onScroll };
};
