/**
 * @file What the Add lesson dialog works out: why it can't be added yet, the
 *   lessons file's size in words, and `ork feedback accept --lesson`, which
 *   names the workflow only when there was a choice and the words only when
 *   they aren't the item's title.
 */

import type { FeedbackDetail, FeedbackItem } from "@krapht/ork-server/client";

import { short } from "./feedback-model.ts";
import { quoted } from "./run-form.ts";

export type LessonPlace = FeedbackDetail["lessons"][number];

export const tokensWords = (tokens: number, cap: number): string =>
  `about ${tokens.toLocaleString("en")} of ${cap.toLocaleString("en")} tokens`;

export const lessonCommand = (
  item: FeedbackItem,
  workflow: string | null,
  text: string,
): string =>
  [
    `ork feedback accept ${short(item.id)} --lesson`,
    ...(workflow === null || item.workflows.length < 2
      ? []
      : [`--workflow ${quoted(workflow)}`]),
    ...(text === item.title || text.trim() === ""
      ? []
      : [`-m ${quoted(text)}`]),
  ].join(" ");

export const lessonBlocked = (
  workflow: string | null,
  text: string,
  place?: LessonPlace,
): string | null => {
  if (workflow === null) return "Choose a workflow.";
  if (text.trim() === "") return "Write the lesson first.";
  return place !== undefined && !place.ok ? place.error : null;
};
