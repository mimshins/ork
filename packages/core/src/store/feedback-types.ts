/**
 * @file The store's feedback port (specs/feedback.md): records as runs wrote
 *   them, grouped by fingerprint into items with a status, and items triage
 *   merged into one another.
 */

import type {
  FeedbackKind,
  FeedbackReport,
  FeedbackSeverity,
  FeedbackSource,
  FeedbackTarget,
} from "../feedback/types.ts";

/** An item's place in triage. */
export type FeedbackStatus =
  | "new"
  | "triaged"
  | "accepted"
  | "dismissed"
  | "published"
  | "resolved";

/** One feedback record, as a run recorded it. */
export type FeedbackRecord = {
  id: number;
  runId: string;
  /** The run event that carried it. */
  seq: number;
  at: string;
  node?: string;
  feedback: FeedbackReport;
};

/**
 * Records with one fingerprint, grouped, with any items triage merged into it
 * (ADR-059).
 */
export type FeedbackItem = {
  /** The fingerprint. */
  id: string;
  /** The fingerprints of the items merged into this one. */
  merged: string[];
  status: FeedbackStatus;
  /** The first record's. */
  title: string;
  target: FeedbackTarget;
  kind: FeedbackKind;
  /** The highest of its records'. */
  severity: FeedbackSeverity;
  sources: FeedbackSource[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  runs: string[];
  workflows: string[];
  models: string[];
};

export type FeedbackStore = {
  /** Items, most recently seen first; without `all`, not the dismissed ones. */
  feedbackItems: (filter?: { all?: boolean }) => FeedbackItem[];
  /** The items whose fingerprint starts with `prefix`. */
  findFeedback: (prefix: string) => FeedbackItem[];
  /** An item's records, oldest first. */
  feedbackRecords: (fingerprint: string) => FeedbackRecord[];
  /** False when there is no such item. */
  setFeedbackStatus: (fingerprint: string, status: FeedbackStatus) => boolean;
  /**
   * Merges the items `from` into `into`: their records and later ones list
   * under it. Items merged into one of `from` follow. Returns how many moved.
   */
  mergeFeedback: (into: string, from: readonly string[]) => number;
  /** Takes apart what was merged into an item; returns how many came back. */
  splitFeedback: (fingerprint: string) => number;
  /** Every record, oldest first; without `all`, not dismissed items'. */
  exportFeedback: (filter?: { all?: boolean }) => FeedbackRecord[];
  /**
   * Adds a record from elsewhere (`ork feedback import`), unless one of its run
   * and event is here; true when it was added. Secrets are masked again.
   */
  importFeedback: (record: Omit<FeedbackRecord, "id">) => boolean;
};
