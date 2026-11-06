/**
 * @file The feedback loop's part of the API's contract (specs/feedback.md): the
 *   items and their records, what a person does with one (dismiss, restore,
 *   accept, maybe as a lesson, apply, publish after a preview), and a person's
 *   note on a run or one node of it. Like the rest of the contract it imports
 *   only `zod` and types, so a browser bundle can use it; a note's kind,
 *   severity and rating are checked where it's recorded, against the same lists
 *   as `ork feedback note`.
 */

import type {
  FeedbackActions,
  FeedbackItem,
  FeedbackRecord,
  LessonPlace,
  LessonWritten,
  Post,
  PostPlan,
} from "@krapht/ork-core";
import { z } from "zod";

export type {
  FeedbackActions,
  FeedbackItem,
  FeedbackRecord,
  LessonPlace,
  LessonWritten,
  Post,
  PostPlan,
};

export const NoteSchema = z.strictObject({
  /** Its first line is the title. */
  text: z.string().min(1),
  /** A node that ran in the run; the run itself without one. */
  node: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  severity: z.string().min(1).optional(),
  rating: z.string().min(1).optional(),
});

/** Dismissing an item, or restoring a dismissed one as `new`. */
export const FeedbackStatusSchema = z.strictObject({
  status: z.enum(["dismissed", "new"]),
});

export const AcceptSchema = z.strictObject({
  /** Also write it into its workflow's lessons file. */
  lesson: z.boolean(),
  /** The lesson's words; the item's title by default. */
  text: z.string().min(1).optional(),
  /** Which workflow's lessons, when it was seen in more than one. */
  workflow: z.string().min(1).optional(),
});

export const ApplySchema = z.strictObject({
  driver: z.enum(["sdk", "cli"]).optional(),
});

export const PublishPreviewSchema = z.strictObject({
  /** Also hide the repositories' and workflows' names. */
  hideNames: z.boolean(),
});

export const PublishSchema = z.strictObject({
  hideNames: z.boolean(),
  /** The preview's digest: what the person saw, so nothing else is sent. */
  digest: z.string().min(1),
});

export const FEEDBACK_API = {
  note: { method: "POST", path: "/api/runs/:id/notes", body: NoteSchema },
  feedbackItems: { method: "GET", path: "/api/feedback" },
  feedbackItem: { method: "GET", path: "/api/feedback/:id" },
  feedbackStatus: {
    method: "POST",
    path: "/api/feedback/:id/status",
    body: FeedbackStatusSchema,
  },
  accept: {
    method: "POST",
    path: "/api/feedback/:id/accept",
    body: AcceptSchema,
  },
  apply: { method: "POST", path: "/api/feedback/:id/apply", body: ApplySchema },
  publishPreview: {
    method: "POST",
    path: "/api/feedback/:id/publish/preview",
    body: PublishPreviewSchema,
  },
  publish: {
    method: "POST",
    path: "/api/feedback/:id/publish",
    body: PublishSchema,
  },
  split: { method: "POST", path: "/api/feedback/:id/split" },
} as const;

/** An item, its records (oldest first), and what can be done with it. */
export type FeedbackDetail = {
  item: FeedbackItem;
  records: FeedbackRecord[];
  /** Which actions it allows, by the rule `ork feedback` keeps too. */
  actions: FeedbackActions;
  /** Where a lesson would go, per workflow it was seen in; none for `ork`. */
  lessons: LessonPlace[];
  /** The tokens a lessons file may hold. */
  lessonCap: number;
  /** The project a fix would be proposed in, or why there's none. */
  project: { ok: true; root: string } | { ok: false; error: string };
  /** The running `ork:feedback-apply` run for it, if any. */
  fixRun?: string;
};

/** Exactly what a publish would send, and where. */
export type PublishPreview = {
  post: Post;
  plan: PostPlan;
  /** The repository whose Discussions it goes to: `owner/name`. */
  repo: string;
  /** Passed back to `publish`, which refuses when what it would send changed. */
  digest: string;
};

/** What each feedback route answers with, on success. */
export type FeedbackResponses = {
  /** The item the note joined. */
  note: { item: string };
  /** Every item, dismissed ones too, most recently seen first. */
  feedbackItems: FeedbackItem[];
  feedbackItem: FeedbackDetail;
  feedbackStatus: FeedbackItem;
  accept: { item: FeedbackItem; lesson?: LessonWritten };
  /** The run that proposes the fix, and the project it runs in. */
  apply: { runId: string; root: string };
  publishPreview: PublishPreview;
  /** The thread posted to, or the +1 comment on one. */
  publish: { item: FeedbackItem; url: string; kind: "created" | "commented" };
  /** How many items came back out of it. */
  split: { moved: number };
};
