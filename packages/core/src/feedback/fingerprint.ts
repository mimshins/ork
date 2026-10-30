/**
 * @file Feedback fingerprints: records about the same thing (same target, kind,
 *   signal code and title, with numbers and punctuation ignored) share one, so
 *   a thousand records become a short list of items.
 */

import { createHash } from "node:crypto";

import type { FeedbackDraft, FeedbackKind, FeedbackTarget } from "./types.ts";

/** A title as fingerprints compare it: lower case, no numbers or punctuation. */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/\d+/gu, "#")
    .replaceAll(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();

export const fingerprint = (parts: {
  target: FeedbackTarget;
  kind: FeedbackKind;
  code?: string;
  title: string;
}): string =>
  createHash("sha256")
    .update(
      [
        parts.target,
        parts.kind,
        parts.code ?? "",
        normalizeTitle(parts.title),
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 12);

/** The target an agent's report is about when it does not say. */
export const defaultTarget = (kind: FeedbackKind): FeedbackTarget => {
  if (kind === "bug") return "ork";
  if (kind === "context-gap" || kind === "skill") return "project";
  return "workflow";
};

/** The draft's target, or its kind's default. */
export const targetOf = (draft: FeedbackDraft): FeedbackTarget =>
  draft.target ?? defaultTarget(draft.kind);
