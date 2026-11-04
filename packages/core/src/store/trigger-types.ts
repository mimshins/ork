/** @file What the store keeps of each trigger on this machine (RFC-011). */

export type TriggerRecord = {
  project: string;
  trigger: string;
  /** The hash a person accepted here; none until one does. */
  acceptedHash?: string;
  /** Whether its first look has been made, which starts nothing. */
  baselined: boolean;
  lookedAt?: string;
  /** Why its last look failed. */
  error?: string;
  /** What's keeping new keys from starting, such as a daily cap. */
  held?: string;
};

/** The process that took the watch lock, and when. */
export type WatchHolder = { pid: number; at: string };

export type TriggerStore = {
  triggerRecords: (project?: string) => TriggerRecord[];
  /** Accepts a trigger as it now is; its next look starts nothing. */
  acceptTrigger: (project: string, trigger: string, hash: string) => void;
  /** Records a look: when, and what went wrong or is holding it. */
  recordLook: (
    project: string,
    trigger: string,
    look: { at: string; error?: string; held?: string },
  ) => void;
  /** The first look's keys, which start nothing. */
  baselineTrigger: (
    project: string,
    trigger: string,
    keys: readonly string[],
    at: string,
  ) => void;
  /** Which of `keys` have been seen. */
  seenKeys: (
    project: string,
    trigger: string,
    keys: readonly string[],
  ) => Set<string>;
  /**
   * Marks a key as started by this run, before it starts: it never starts
   * twice. `false` when it already was, and this run mustn't start.
   */
  markStarted: (
    project: string,
    trigger: string,
    key: string,
    runId: string,
    at: string,
  ) => boolean;
  /** Keeps a key from being tried again, with no run to show for it. */
  giveUpOn: (project: string, trigger: string, key: string, at: string) => void;
  /** A run that didn't start after all, so its key can be tried again. */
  unmarkStarted: (project: string, trigger: string, key: string) => void;
  /** The runs it started since an ISO time. */
  triggerRuns: (project: string, trigger: string, since: string) => string[];
  /** Who holds the one `ork watch` on this machine, gone or not. */
  watchHolder: () => WatchHolder | undefined;
  /**
   * Takes that lock unless `holds` says its holder is still there, in one
   * transaction, so two can't both get it. The holder that's in the way, or
   * `null` when it's taken.
   */
  takeWatchHolder: (
    me: WatchHolder,
    holds: (holder: WatchHolder) => boolean,
  ) => WatchHolder | null;
  releaseWatchHolder: (pid: number) => void;
};
