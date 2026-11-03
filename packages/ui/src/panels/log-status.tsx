/**
 * @file The Logs panel's line about what is loaded, and its two ways to move:
 *   reading older events, and following the newest or holding still. Both stay
 *   in place as they change, so the focus is never lost.
 */

import { Button } from "../components/button.tsx";
import { IconCheck } from "../components/icons.tsx";
import { hasOlder, lastOf } from "../state/event-window.ts";
import type { RunEvents, RunFeed } from "../state/run-feed.ts";

import styles from "./logs.module.css";

export const LogStatus = ({
  events,
  shown,
  feed,
  cli,
}: {
  events: RunEvents;
  shown: number;
  feed: RunFeed;
  /** The command that shows the same. */
  cli: string;
}) => {
  const loaded = events.events.length;
  const behind = events.latest - lastOf(events);
  return (
    <div className={styles["status"]}>
      <span className={styles["counts"]}>
        {shown === loaded
          ? `${String(shown)} events`
          : `${String(shown)} of ${String(loaded)} loaded`}
        {events.latest > loaded ? `, ${String(events.latest)} in the run` : ""}
      </span>
      <Button
        disabled={!hasOlder(events) || events.paging}
        focusableWhenDisabled
        onClick={() => {
          void feed.loadOlder();
        }}
        variant="ghost"
      >
        Load older
      </Button>
      <Button
        aria-pressed={events.following}
        cli={cli}
        onClick={() => {
          if (events.following) feed.hold();
          else void feed.follow();
        }}
        variant="ghost"
      >
        {events.following ? <IconCheck /> : null}
        Follow{behind > 0 ? ` (${String(behind)} new)` : ""}
      </Button>
    </div>
  );
};
