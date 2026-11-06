/**
 * @file The status badge: a glyph and a word, never color alone. Each status
 *   has its own shape. It holds the words for run and node states in the CLI's
 *   nouns; a running one blinks, unless the user asks for less motion. It sits
 *   bare among other facts; a pill tints it, for the one that heads a view.
 *   `ItemStatusBadge` does the same for a feedback item's status, on the same
 *   tones, so `Status` stays the run and node states.
 */

import type { ComponentType } from "react";

import {
  GlyphAccepted,
  GlyphFailed,
  GlyphInterrupted,
  GlyphNew,
  GlyphPaused,
  GlyphPublished,
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

const Badge = ({ look, pill }: { look: Look; pill: boolean }) => {
  const { Icon, word, tone } = look;
  return (
    <span
      className={styles["badge"]}
      data-look={pill ? "pill" : "bare"}
      data-tone={tone}
    >
      <span className={styles["icon"]}>
        <Icon />
      </span>
      {word}
    </span>
  );
};

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
  const look = LOOKS[status];
  return (
    <Badge
      look={{ ...look, word: word ?? look.word }}
      pill={pill}
    />
  );
};

/** A feedback item's place in triage, as `ork feedback list` says it. */
export type ItemStatus =
  | "new"
  | "triaged"
  | "accepted"
  | "resolved"
  | "published"
  | "dismissed";

/** `new` needs the person (amber); what's settled is done (phosphor). */
const ITEM_LOOKS: Record<ItemStatus, Look> = {
  new: { Icon: GlyphNew, word: "new", tone: "waiting" },
  triaged: { Icon: GlyphQueued, word: "triaged", tone: "queued" },
  accepted: { Icon: GlyphAccepted, word: "accepted", tone: "queued" },
  resolved: { Icon: GlyphSucceeded, word: "resolved", tone: "succeeded" },
  published: { Icon: GlyphPublished, word: "published", tone: "succeeded" },
  dismissed: { Icon: GlyphSkipped, word: "dismissed", tone: "skipped" },
};

export const ItemStatusBadge = ({
  status,
  pill = false,
}: {
  status: ItemStatus;
  pill?: boolean;
}) => (
  <Badge
    look={ITEM_LOOKS[status]}
    pill={pill}
  />
);
