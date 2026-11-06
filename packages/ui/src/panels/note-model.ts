/**
 * @file What the Note dialog works out (specs/feedback.md): the choices `ork
 *   feedback note` takes, as lists so nothing can be mistyped; the severity a
 *   bad rating raises while the person hasn't chosen one, as the CLI does; what
 *   is sent; and the CLI twin, leaving out what's the default.
 */

import { quoted } from "./run-form.ts";

/** `ork feedback note --kind`'s list, friction first as its default. */
export const NOTE_KINDS = [
  "friction",
  "bug",
  "context-gap",
  "skill",
  "workflow",
  "idea",
] as const;

export const NOTE_SEVERITIES = ["low", "medium", "high"] as const;

/** The rating is optional: none is its own choice. */
export const NOTE_RATINGS = [
  { value: "", label: "No rating" },
  { value: "good", label: "good" },
  { value: "bad", label: "bad" },
] as const;

export type NoteDraft = {
  text: string;
  /** "" for none. */
  rating: string;
  kind: string;
  /** Null until the person chooses one. */
  severity: string | null;
};

export const EMPTY_NOTE: NoteDraft = {
  text: "",
  rating: "",
  kind: "friction",
  severity: null,
};

/** The severity it's sent with: the person's, or the CLI's default. */
export const severityOf = ({ rating, severity }: NoteDraft): string =>
  severity ?? (rating === "bad" ? "high" : "medium");

/** Whether the severity came from the rating, which its description says. */
export const fromRating = (draft: NoteDraft): boolean =>
  draft.severity === null && draft.rating === "bad";

/** Why it can't be added yet, if it can't. */
export const noteBlocked = (draft: NoteDraft): string | null =>
  draft.text.trim() === "" ? "Write the note first." : null;

/** The note route's body. */
export const noteBody = (node: string | undefined, draft: NoteDraft) => ({
  text: draft.text,
  ...(node === undefined ? {} : { node }),
  kind: draft.kind,
  severity: severityOf(draft),
  ...(draft.rating === "" ? {} : { rating: draft.rating }),
});

/** `ork feedback note`, with only what differs from its defaults. */
export const noteCommand = (
  runId: string,
  node: string | undefined,
  draft: NoteDraft,
): string => {
  const derived = severityOf({ ...draft, severity: null });
  const severity = severityOf(draft);
  return [
    "ork feedback note",
    runId,
    ...(node === undefined ? [] : [quoted(node)]),
    "-m",
    draft.text.trim() === "" ? "<text>" : quoted(draft.text),
    ...(draft.kind === "friction" ? [] : [`--kind ${draft.kind}`]),
    ...(severity === derived ? [] : [`--severity ${severity}`]),
    ...(draft.rating === "" ? [] : [`--rating ${draft.rating}`]),
  ].join(" ");
};

/** What a toast says once a note is recorded, naming the item it joined. */
export const notedWords = (
  runId: string,
  node: string | undefined,
  item: string,
) => ({
  title:
    node === undefined ? `Noted on run \`${runId}\`` : `Noted on \`${node}\``,
  description: `It joined item \`${item.slice(0, 12)}\`.`,
});
