/**
 * @file The status badge: a glyph and a word, never color alone. Each status
 *   has its own shape. It holds the words for run and node states in the CLI's
 *   nouns; a running one blinks, unless the user asks for less motion. It sits
 *   bare among other facts; a pill tints it, for the one that heads a view.
 */

import type { ComponentType } from "react";

import {
  GlyphFailed,
  GlyphInterrupted,
  GlyphPaused,
  GlyphQueued,
  GlyphRunning,
  GlyphSkipped,
  GlyphSucceeded,
  GlyphWaiting,
} from "./status-glyphs.tsx";

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
  | "quota_exhausted"
  | "timed_out";

type Look = { Icon: ComponentType; word: string; tone: string };

const LOOKS: Record<Status, Look> = {
  running: { Icon: GlyphRunning, word: "running", tone: "running" },
  succeeded: { Icon: GlyphSucceeded, word: "succeeded", tone: "succeeded" },
  waiting: { Icon: GlyphWaiting, word: "waiting on you", tone: "waiting" },
  paused: { Icon: GlyphPaused, word: "paused", tone: "paused" },
  failed: { Icon: GlyphFailed, word: "failed", tone: "failed" },
  crashed: { Icon: GlyphFailed, word: "crashed", tone: "failed" },
  queued: { Icon: GlyphQueued, word: "queued", tone: "queued" },
  skipped: { Icon: GlyphSkipped, word: "skipped", tone: "skipped" },
  interrupted: {
    Icon: GlyphInterrupted,
    word: "interrupted",
    tone: "interrupted",
  },
  budget_exhausted: {
    Icon: GlyphInterrupted,
    word: "budget exhausted",
    tone: "interrupted",
  },
  quota_exhausted: {
    Icon: GlyphInterrupted,
    word: "quota spent",
    tone: "interrupted",
  },
  timed_out: {
    Icon: GlyphInterrupted,
    word: "timed out",
    tone: "interrupted",
  },
};

/** The status in words, for what names a thing in text. */
export const statusWord = (status: Status): string => LOOKS[status].word;

/** The color family the status belongs to, for what is drawn around a badge. */
export const statusTone = (status: Status): string => LOOKS[status].tone;

export const StatusBadge = ({
  status,
  word,
  pill = false,
}: {
  status: Status;
  /** Says this in place of the status's own word. */
  word?: string | undefined;
  /** Tints it, for the status that heads a view. */
  pill?: boolean;
}) => {
  const { Icon, word: own, tone } = LOOKS[status];
  return (
    <span
      className={styles["badge"]}
      data-look={pill ? "pill" : "bare"}
      data-tone={tone}
    >
      <span className={styles["icon"]}>
        <Icon />
      </span>
      {word ?? own}
    </span>
  );
};
