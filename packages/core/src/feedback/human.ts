/**
 * @file Human notes (specs/feedback.md): a person's rating or note on a run or
 *   one node's result, from `ork feedback note`. It becomes a
 *   `feedback.recorded` event of that run with source `human`, grouped and
 *   triaged like agent and system records.
 */

import type { RunEvent } from "../run/types.ts";
import { maskSecrets } from "../store/mask.ts";
import { fingerprint, targetOf } from "./fingerprint.ts";
import type {
  FeedbackKind,
  FeedbackReport,
  FeedbackSeverity,
  FeedbackTarget,
} from "./types.ts";

export const RATINGS = ["good", "bad"] as const;
export type Rating = (typeof RATINGS)[number];

export type HumanNote = {
  text: string;
  workflow: string;
  node?: string;
  kind?: FeedbackKind;
  target?: FeedbackTarget;
  severity?: FeedbackSeverity;
  rating?: Rating;
};

const MAX_TITLE = 120;

/** The run event a note becomes; its title is the note's first line. */
export const humanNoteEvent = (note: HumanNote): RunEvent => {
  const text = maskSecrets(note.text.trim());
  const [first = ""] = text.split("\n");
  const title = first.slice(0, MAX_TITLE);
  const kind = note.kind ?? "friction";
  const target = targetOf({
    kind,
    title,
    ...(note.target === undefined ? {} : { target: note.target }),
  });
  const feedback: FeedbackReport = {
    source: "human",
    kind,
    target,
    severity: note.severity ?? (note.rating === "bad" ? "high" : "medium"),
    title,
    body: text,
    evidence: note.rating === undefined ? [] : [`rating: ${note.rating}`],
    fingerprint: fingerprint({ target, kind, title }),
    origin: { workflow: note.workflow },
  };
  return {
    type: "feedback.recorded",
    ...(note.node === undefined ? {} : { node: note.node }),
    feedback,
  };
};
