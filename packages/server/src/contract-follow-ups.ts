/**
 * @file The follow-ups' part of the API's contract (specs/follow-ups.md): a
 *   project's list, one follow-up with what to copy from it, what a person does
 *   with it (done, drop, reopen, make due), posting a drafted GitHub comment
 *   only once the person confirmed its exact text, and the due count the
 *   overview stream sends for a badge. Like the rest of the contract it imports
 *   only `zod` and types, so a browser bundle can use it.
 */

import type {
  FollowUp,
  FollowUpAction,
  FollowUpActionCheck,
  FollowUpActions,
  FollowUpCause,
  FollowUpFor,
  FollowUpKind,
  FollowUpRelayed,
  FollowUpStatus,
} from "@krapht/ork-core";
import type { FollowUpPlace } from "@krapht/ork-schema";
import { z } from "zod";

export type {
  FollowUp,
  FollowUpAction,
  FollowUpActionCheck,
  FollowUpActions,
  FollowUpCause,
  FollowUpFor,
  FollowUpKind,
  FollowUpPlace,
  FollowUpRelayed,
  FollowUpStatus,
};

/** `open` is due and waiting, the default; `all` adds done and dropped. */
export const FollowUpsQuerySchema = z.strictObject({
  status: z
    .enum(["open", "all", "due", "waiting", "done", "dropped"])
    .optional(),
  /** Only those for this: `agent`, `me`, `project:<name>` or `person:<name>`. */
  for: z.string().min(1).optional(),
});

export const FollowUpChangeSchema = z.strictObject({
  action: z.enum(["done", "drop", "reopen", "due"]),
});

/**
 * Posts a drafted GitHub comment through the person's own `gh`. `confirm` says
 * yes, and `digest` is the detail's `draftDigest`, which stands for the
 * recipient and text they saw: the route refuses when the draft is no longer
 * that, so nothing else is sent.
 */
export const FollowUpPostSchema = z.strictObject({
  confirm: z.literal(true),
  digest: z.string().min(1),
});

export const FOLLOW_UPS_API = {
  followUps: {
    method: "GET",
    path: "/api/projects/:id/follow-ups",
    query: FollowUpsQuerySchema,
  },
  followUp: { method: "GET", path: "/api/projects/:id/follow-ups/:followUp" },
  followUpChange: {
    method: "POST",
    path: "/api/projects/:id/follow-ups/:followUp",
    body: FollowUpChangeSchema,
  },
  followUpPost: {
    method: "POST",
    path: "/api/projects/:id/follow-ups/:followUp/post",
    body: FollowUpPostSchema,
  },
} as const;

/** A project's follow-ups, after the due check. */
export type FollowUpsList = {
  /** The project's root. */
  project: string;
  /** Oldest first; filtered by the query. */
  followUps: FollowUp[];
  /** How many of the project's follow-ups are due, whatever the filter. */
  due: number;
  /**
   * Whether the due check could read pull requests through the person's `gh`;
   * when it couldn't, `errors` says why and `after-merge` follow-ups wait.
   */
  checker: { available: boolean; errors: string[] };
};

/** Where a `project:<name>` follow-up went. */
export type FollowUpDelivery = {
  /** The name in `for`. */
  project: string;
  registered: boolean;
  /** Its root, and where its own rule keeps follow-ups. */
  root?: string;
  keptIn?: FollowUpPlace;
  /** The live run (and its node) a session there could be told through. */
  live?: FollowUpRelayed;
};

/** One follow-up, what can be done to it, and what to copy from it. */
export type FollowUpDetail = {
  followUp: FollowUp;
  /** Each action, or why not, as `feedbackActions` does for feedback. */
  actions: FollowUpActions;
  /** Why it is due, when it is. */
  cause?: FollowUpCause;
  /** Where it is kept; `fallback` says why that isn't where the rule says. */
  keptIn: {
    place: FollowUpPlace;
    url?: string;
    rule: FollowUpPlace;
    fallback?: string;
  };
  delivery?: FollowUpDelivery;
  /** Stands for the draft's recipient and text; `post` must send it back. */
  draftDigest?: string;
  copy: {
    /** The draft's text; empty when it has none. */
    text: string;
    /** Each step's command, in order; Ork never runs them. */
    commands: string[];
  };
};

/** A due follow-up, as the overview stream's badge and notice show it. */
export type FollowUpDueItem = {
  id: string;
  /** The project's root. */
  project: string;
  title: string;
  for: FollowUpFor;
  kind: FollowUpKind;
  note?: string;
};

/** The due follow-ups of the projects the stream covers. */
export type FollowUpsDue = {
  count: number;
  /** The most recently changed first, at most 20. */
  items: FollowUpDueItem[];
};

/** What each follow-up route answers with, on success. */
export type FollowUpsResponses = {
  followUps: FollowUpsList;
  followUp: FollowUpDetail;
  followUpChange: FollowUpDetail;
  /** The comment's URL when `gh` printed one, and the follow-up, now done. */
  followUpPost: { url?: string; followUp: FollowUpDetail };
};

/**
 * What the overview stream also sends (`STREAMS.overview`): `followUps` each
 * time the due ones change, not before one is due. The UI's badge and notice
 * read it; a page that doesn't listen for it ignores it, and the UI merges it
 * into `OverviewEvents`.
 */
export type OverviewFollowUpEvents = { followUps: FollowUpsDue };
