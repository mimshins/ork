/**
 * @file Human notes (specs/feedback.md): a person's rating or note on a run or
 *   one node's result, from `ork feedback note`, `ork decide --note` or the UI.
 *   It becomes a `feedback.recorded` event of that run with source `human`,
 *   grouped and triaged like agent and system records.
 */

import type { RunEvent } from "../run/types.ts";
import { maskSecrets } from "../store/mask.ts";
import type { EventStore, RunRecord } from "../store/types.ts";
import { fingerprint, targetOf } from "./fingerprint.ts";
import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  type FeedbackKind,
  type FeedbackReport,
  type FeedbackSeverity,
  type FeedbackTarget,
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

/**
 * The run event a note becomes; its title is the note's first line. `scrub` (an
 * env-value scrubber) runs after `maskSecrets`.
 */
export const humanNoteEvent = (
  note: HumanNote,
  scrub: (text: string) => string = text => text,
): RunEvent => {
  const text = scrub(maskSecrets(note.text.trim()));
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

/** What a person writes to note a run or one of its nodes, unchecked. */
export type NoteAsk = {
  text: string;
  node?: string | undefined;
  kind?: string | undefined;
  severity?: string | undefined;
  rating?: string | undefined;
};

export type Noted = { ok: true; item: string } | { ok: false; error: string };

/** `value` when it's one of `allowed`, or why not. */
const checked = <T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): { ok: true; value?: T } | { ok: false; error: string } => {
  if (value === undefined) return { ok: true };
  const found = allowed.find(a => a === value);
  return found === undefined
    ? { ok: false, error: `${name} is one of ${allowed.join(", ")}` }
    : { ok: true, value: found };
};

export type CheckedNote =
  | {
      ok: true;
      kind?: FeedbackKind;
      severity?: FeedbackSeverity;
      rating?: Rating;
    }
  | { ok: false; error: string };

/**
 * Whether a note can be recorded, before anything else is done: its words,
 * kind, severity and rating. `flag` names the options as the caller does (`--`
 * for the CLI).
 */
export const checkNote = (ask: NoteAsk, flag = ""): CheckedNote => {
  if (ask.text.trim() === "") return { ok: false, error: "The note is empty." };
  const kind = checked(`${flag}kind`, ask.kind, FEEDBACK_KINDS);
  const severity = checked(
    `${flag}severity`,
    ask.severity,
    FEEDBACK_SEVERITIES,
  );
  const rating = checked(`${flag}rating`, ask.rating, RATINGS);
  if (!kind.ok) return kind;
  if (!severity.ok) return severity;
  if (!rating.ok) return rating;
  return {
    ok: true,
    ...(kind.value === undefined ? {} : { kind: kind.value }),
    ...(severity.value === undefined ? {} : { severity: severity.value }),
    ...(rating.value === undefined ? {} : { rating: rating.value }),
  };
};

/**
 * Records a person's note on `run`, or one node that ran in it, as that run's
 * feedback (a run that ended takes it too); returns the item it joins (the one
 * it was merged into, when triage merged it), or why it can't. `ork feedback
 * note`, `ork decide --note` and the UI write it.
 */
export const recordNote = (
  store: Pick<EventStore, "events" | "append" | "findFeedback">,
  run: Pick<RunRecord, "id" | "workflow">,
  ask: NoteAsk,
  flag = "",
  scrub?: (text: string) => string,
): Noted => {
  const note = checkNote(ask, flag);
  if (!note.ok) return note;
  const ran = store
    .events(run.id)
    .some(({ event }) => "id" in event && event.id === ask.node);
  if (ask.node !== undefined && !ran) {
    return { ok: false, error: `No node ${ask.node} ran in run ${run.id}.` };
  }
  const event = humanNoteEvent(
    {
      text: ask.text,
      workflow: run.workflow,
      ...(ask.node === undefined ? {} : { node: ask.node }),
      ...(note.kind === undefined ? {} : { kind: note.kind }),
      ...(note.severity === undefined ? {} : { severity: note.severity }),
      ...(note.rating === undefined ? {} : { rating: note.rating }),
    },
    scrub,
  );
  store.append(run.id, event);
  const recorded =
    event.type === "feedback.recorded" ? event.feedback.fingerprint : "";
  return {
    ok: true,
    item: store.findFeedback(recorded)[0]?.id ?? recorded,
  };
};
