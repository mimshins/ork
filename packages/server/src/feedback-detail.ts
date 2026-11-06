/**
 * @file An item as the Feedback panel shows it: its records, which actions it
 *   allows (the rule `ork feedback` keeps too), where a lesson for each of its
 *   workflows would go and how big that file is, the project a fix would be
 *   proposed in, and the run proposing one now, if any.
 */

import {
  type EventStore,
  type FeedbackItem,
  feedbackActions,
  LESSON_CAP_TOKENS,
  lessonPlaceOf,
  openFixRun,
  placeOf,
} from "@krapht/ork-core";

import type { FeedbackDetail } from "./contract-feedback.ts";

export const detailOf = (
  store: EventStore,
  item: FeedbackItem,
): FeedbackDetail => {
  const registered = store.projects();
  const fixRun = openFixRun(store, item);
  const actions = feedbackActions(item, fixRun);
  const found = placeOf(store, item, undefined, registered);
  return {
    item,
    records: store.feedbackRecords(item.id),
    actions,
    lessons:
      item.target === "ork"
        ? []
        : item.workflows.map(w => lessonPlaceOf(store, item, w, registered)),
    lessonCap: LESSON_CAP_TOKENS,
    // An `ork` item's fix isn't in a project of yours.
    project:
      found.ok && item.target !== "ork"
        ? { ok: true, root: found.place.root }
        : {
            ok: false,
            error: found.ok ? "It's about Ork itself." : found.error,
          },
    ...(fixRun === undefined ? {} : { fixRun }),
  };
};
