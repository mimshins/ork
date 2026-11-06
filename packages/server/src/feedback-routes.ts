/**
 * @file The feedback loop's routes (specs/feedback.md): a person's note on a
 *   run, or one node of it, recorded as that run's feedback with the same
 *   checks as `ork feedback note`.
 */

import { recordNote } from "@krapht/ork-core";

import { runOf, type ServerContext } from "./context.ts";
import { fail, type Handlers, ok } from "./router.ts";

type FeedbackRoutes = Pick<Handlers, "note">;

export const feedbackRoutes = (context: ServerContext): FeedbackRoutes => ({
  note: ({ params, body }) => {
    const found = runOf(context, params.id);
    if (!found.ok) return found.refusal;
    const noted = recordNote(context.store, found.run, body);
    return noted.ok ? ok({ item: noted.item }) : fail(400, noted.error);
  },
});
