/**
 * @file Follow-ups' shapes: work a shipped change leaves for later (a change
 *   for an agent, a message for a person, a task or a check for the
 *   maintainer), who acts on it, when it is due, and the port that keeps them
 *   where the project's `followUps` rule says. Apart from feedback, which is
 *   about the process.
 */

import type { FollowUpPlace, FollowUpsRule } from "@krapht/ork-schema";

import type { GhRunner } from "../feedback/discussions.ts";

export const FOLLOW_UP_KINDS = ["change", "message", "task", "check"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_STATUSES = [
  "waiting",
  "due",
  "done",
  "dropped",
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/**
 * Who acts: an agent's later run, another registered project, the maintainer or
 * a person.
 */
export type FollowUpFor =
  | "agent"
  | "me"
  | `project:${string}`
  | `person:${string}`;

/**
 * When it comes due: at once, after the `ref` merges, after a deploy, or a
 * `YYYY-MM-DD` date.
 */
export type FollowUpDue =
  | "now"
  | "after-merge"
  | "after-deploy"
  | `${number}-${number}-${number}`;

/** A message Ork drafts and the maintainer sends. */
export type FollowUpDraft = {
  to: string;
  /** A hint: `github`, `slack`, `email`… */
  channel?: string;
  text: string;
};

/** A step of a task or check; Ork shows its command and never runs it. */
export type FollowUpStep = { text: string; command?: string };

/** The run and node a follow-up came from; the maintainer's has neither. */
export type FollowUpFrom = { run?: string; node?: string };

/** What a session, a plan or the maintainer gives; Ork fills in the rest. */
export type NewFollowUp = {
  title: string;
  body?: string;
  for: FollowUpFor;
  kind: FollowUpKind;
  due: FollowUpDue;
  /** Files it is about, relative to the project root. */
  where?: string[];
  from?: FollowUpFrom;
  /** The PR or branch it waits on. */
  ref?: string;
  draft?: FollowUpDraft;
  steps?: FollowUpStep[];
};

export type FollowUp = {
  id: string;
  /** The project root it belongs to, absolute. */
  project: string;
  title: string;
  body: string;
  for: FollowUpFor;
  kind: FollowUpKind;
  due: FollowUpDue;
  where: string[];
  from: FollowUpFrom;
  status: FollowUpStatus;
  ref?: string;
  draft?: FollowUpDraft;
  steps?: FollowUpStep[];
  /** Where it was written out besides Ork's store. */
  place: FollowUpPlace;
  /** The GitHub issue's URL, or the file it was appended to. */
  url?: string;
  /** Why it last changed status, e.g. a ref closed unmerged. */
  note?: string;
  /** The run that took it as its brief (`agent`); done when that run publishes. */
  takenBy?: string;
  createdAt: string;
  updatedAt: string;
};

/** Where a follow-up for another project was also sent: a live session there. */
export type FollowUpRelayed = { run: string; node: string };

/** What a session's `follow_up` call came to. */
export type FollowUpDelivered =
  | {
      ok: true;
      added: FollowUpAdded;
      /** Set when it went to a live run of the project it is for. */
      relayed?: FollowUpRelayed;
    }
  | { ok: false; error: string };

/** A session's way to leave a follow-up (the `follow_up` tool). */
export type FollowUpPort = {
  add: (input: NewFollowUp) => Promise<FollowUpDelivered>;
};

/** How a run keeps a session's follow-up; `cwd` is the session's worktree. */
export type FollowUpSink = (
  input: NewFollowUp,
  at: { node: string; cwd: string },
) => Promise<FollowUpDelivered>;

export type FollowUpAdded = {
  followUp: FollowUp;
  /** It merged into an open follow-up already kept, which `followUp` is. */
  merged: boolean;
  /** What the person should know, e.g. GitHub fell back to the store. */
  note?: string;
};

export type FollowUpFilter = {
  status?: readonly FollowUpStatus[];
};

/** What a place adapter writes a new follow-up out with. */
export type FollowUpKeepContext = {
  /** The project root, absolute. */
  project: string;
  /** The run's worktree, or the project root; a `file` is written here. */
  worktree: string;
  rule: FollowUpsRule;
  gh: GhRunner;
};

/** Where it was written out: another place than asked when it fell back. */
export type FollowUpKept = {
  place: FollowUpPlace;
  url?: string;
  note?: string;
};

/** One `followUps.store` value: how a new follow-up is written out. */
export type FollowUpPlaceAdapter = {
  place: FollowUpPlace;
  keep: (
    followUp: FollowUp,
    context: FollowUpKeepContext,
  ) => Promise<FollowUpKept>;
};

/** A project's follow-ups, wherever its rule keeps them. */
export type FollowUpStore = {
  /** Where new follow-ups are written out, per the project's rule. */
  place: FollowUpPlace;
  /** Scrubs it, merges it into a duplicate, or keeps it as new. */
  add: (input: NewFollowUp) => Promise<FollowUpAdded>;
  /** The project's follow-ups, oldest first. */
  list: (filter?: FollowUpFilter) => FollowUp[];
  get: (id: string) => FollowUp | undefined;
  /** `undefined` when there is no follow-up with that id. */
  setStatus: (
    id: string,
    status: FollowUpStatus,
    note?: string,
  ) => FollowUp | undefined;
};
