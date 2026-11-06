/**
 * @file The feedback loop's routes (specs/feedback.md), through the same core
 *   functions as `ork feedback`: the items and an item's records; dismiss and
 *   restore; accept, maybe as a lesson; apply, which starts `ork feedback
 *   apply` in the background so its keep-or-discard ends the same way; publish
 *   after a preview, sending only what the preview showed; and a person's note
 *   on a run, or one node of it.
 */

import {
  acceptItem,
  type EventStore,
  type FeedbackItem,
  recordNote,
} from "@krapht/ork-core";

import { runOf, type ServerContext } from "./context.ts";
import { applyRoute } from "./feedback-apply.ts";
import { detailOf } from "./feedback-detail.ts";
import { previewOf, sendPublish } from "./feedback-publish.ts";
import { fail, type Handlers, ok } from "./router.ts";

type FeedbackRoutes = Pick<
  Handlers,
  | "note"
  | "feedbackItems"
  | "feedbackItem"
  | "feedbackStatus"
  | "accept"
  | "apply"
  | "publishPreview"
  | "publish"
  | "split"
>;

type Refusal = { status: 400 | 404 | 409; error: string };

/** The item `id` names (its fingerprint, or a group's member), or a 404. */
export const itemOf = (
  store: EventStore,
  id: string,
): { ok: true; item: FeedbackItem } | { ok: false; refusal: Refusal } => {
  const [item, other] = store.findFeedback(id);
  return item === undefined || other !== undefined
    ? { ok: false, refusal: fail(404, `No feedback item ${id}.`) }
    : { ok: true, item };
};

/** The item as it is now, after a write. */
const fresh = (store: EventStore, item: FeedbackItem): FeedbackItem =>
  store.findFeedback(item.id)[0] ?? item;

export const feedbackRoutes = (context: ServerContext): FeedbackRoutes => {
  const { store } = context;
  return {
    note: ({ params, body }) => {
      const found = runOf(context, params.id);
      if (!found.ok) return found.refusal;
      const noted = recordNote(store, found.run, body);
      return noted.ok ? ok({ item: noted.item }) : fail(400, noted.error);
    },

    feedbackItems: () => ok(store.feedbackItems({ all: true })),

    feedbackItem: ({ params }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      return ok(detailOf(store, found.item));
    },

    feedbackStatus: ({ params, body }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      const { item } = found;
      if (body.status === "new" && item.status !== "dismissed") {
        return fail(
          409,
          `${item.id.slice(0, 12)} isn't dismissed, so there's nothing to restore.`,
        );
      }
      store.setFeedbackStatus(item.id, body.status);
      return ok(fresh(store, item));
    },

    accept: ({ params, body }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      const accepted = acceptItem(
        store,
        found.item,
        body,
        context.store.projects(),
      );
      if (!accepted.ok) return fail(409, accepted.error);
      return ok({
        item: fresh(store, found.item),
        ...(accepted.lesson === undefined ? {} : { lesson: accepted.lesson }),
      });
    },

    apply: ({ params, body }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      return applyRoute(context, found.item, body.driver);
    },

    publishPreview: async ({ params, body }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      const previewed = await previewOf(context, found.item, body.hideNames);
      return previewed.ok ? ok(previewed.preview) : previewed.refusal;
    },

    publish: async ({ params, body }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      const sent = await sendPublish(context, found.item, body);
      return sent.ok
        ? ok({ item: fresh(store, found.item), url: sent.url, kind: sent.kind })
        : sent.refusal;
    },

    split: ({ params }) => {
      const found = itemOf(store, params.id);
      if (!found.ok) return found.refusal;
      if (found.item.merged.length === 0) {
        return fail(
          409,
          `Nothing was merged into ${found.item.id.slice(0, 12)}, so there's nothing to split.`,
        );
      }
      return ok({ moved: store.splitFeedback(found.item.id) });
    },
  };
};
