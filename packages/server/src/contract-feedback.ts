/**
 * @file The feedback loop's part of the API's contract (specs/feedback.md): a
 *   person's note on a run, or one node of it, which joins the run's feedback.
 *   Like the rest of the contract it imports only `zod` and types, so a browser
 *   bundle can use it; the note's kind, severity and rating are checked where
 *   it's recorded, against the same lists as `ork feedback note`.
 */

import { z } from "zod";

export const NoteSchema = z.strictObject({
  /** Its first line is the title. */
  text: z.string().min(1),
  /** A node that ran in the run; the run itself without one. */
  node: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  severity: z.string().min(1).optional(),
  rating: z.string().min(1).optional(),
});

export const FEEDBACK_API = {
  note: { method: "POST", path: "/api/runs/:id/notes", body: NoteSchema },
} as const;

/** What each feedback route answers with, on success. */
export type FeedbackResponses = {
  /** The item the note joined. */
  note: { item: string };
};
