/**
 * @file The status badge: an icon and a word, never color alone. Each status
 *   has its own shape. It holds the words for run and node states in the CLI's
 *   nouns; a running one pulses, unless the user asks for less motion.
 */

import type { ComponentType } from "react";

import {
  IconFailed,
  IconInterrupted,
  IconPaused,
  IconQueued,
  IconRunning,
  IconSkipped,
  IconSucceeded,
  IconWaiting,
} from "./icons.tsx";

import styles from "./status-badge.module.css";

export type Status =
  | "running"
  | "succeeded"
  | "waiting"
  | "paused"
  | "failed"
  | "crashed"
  | "queued"
  | "skipped"
  | "interrupted"
  | "budget_exhausted"
  | "timed_out";

type Look = { Icon: ComponentType; word: string; tone: string };

const LOOKS: Record<Status, Look> = {
  running: { Icon: IconRunning, word: "running", tone: "running" },
  succeeded: { Icon: IconSucceeded, word: "succeeded", tone: "succeeded" },
  waiting: { Icon: IconWaiting, word: "waiting on you", tone: "waiting" },
  paused: { Icon: IconPaused, word: "paused", tone: "paused" },
  failed: { Icon: IconFailed, word: "failed", tone: "failed" },
  crashed: { Icon: IconFailed, word: "crashed", tone: "failed" },
  queued: { Icon: IconQueued, word: "queued", tone: "queued" },
  skipped: { Icon: IconSkipped, word: "skipped", tone: "skipped" },
  interrupted: {
    Icon: IconInterrupted,
    word: "interrupted",
    tone: "interrupted",
  },
  budget_exhausted: {
    Icon: IconInterrupted,
    word: "budget exhausted",
    tone: "interrupted",
  },
  timed_out: {
    Icon: IconInterrupted,
    word: "timed out",
    tone: "interrupted",
  },
};

/** The status in words, for what names a thing in text. */
export const statusWord = (status: Status): string => LOOKS[status].word;

/** The color family the status belongs to, for what is drawn around a badge. */
export const statusTone = (status: Status): string => LOOKS[status].tone;

export const StatusBadge = ({ status }: { status: Status }) => {
  const { Icon, word, tone } = LOOKS[status];
  return (
    <span
      className={styles["badge"]}
      data-tone={tone}
    >
      <span className={styles["icon"]}>
        <Icon />
      </span>
      {word}
    </span>
  );
};
