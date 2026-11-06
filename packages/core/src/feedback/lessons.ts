/**
 * @file Accepting a feedback item as a lesson (specs/feedback.md, ADR-059): one
 *   line in the workflow's `.ork/lessons/<workflow>.md`, marked with the item
 *   it came from so it isn't added twice, and refused when it would take the
 *   file past the cap a session loads. Only a person's acceptance writes one:
 *   feedback is model output that repository content can steer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { estimateTokens, LESSON_CAP_TOKENS } from "../context/lesson-cap.ts";
import { placeFiles, type ProjectPlace } from "../project/place.ts";

/** A workflow's lessons file in a project. */
export const lessonsFileOf = (place: ProjectPlace, workflow: string): string =>
  path.join(placeFiles(place).lessons, `${workflow}.md`);

/** What marks a lesson with its item, in the file. */
export const lessonMark = (item: string): string =>
  `<!-- feedback ${item.slice(0, 12)} -->`;

export type LessonAsk = {
  /** The lessons file. */
  file: string;
  /** How messages name the file: project-relative. */
  shownAs: string;
  workflow: string;
  /** The item's id (its fingerprint). */
  item: string;
  /** The lesson's words; more lines are kept under the first. */
  text: string;
};

export type LessonResult =
  | { ok: true; tokens: number }
  | { ok: false; error: string };

/** The lesson as one list entry, its later lines indented under the first. */
const entryOf = (text: string, item: string): string => {
  const [first = "", ...rest] = text
    .trim()
    .split("\n")
    .map(line => line.trimEnd());
  return [`- ${first} ${lessonMark(item)}`, ...rest.map(l => `  ${l}`)]
    .join("\n")
    .concat("\n");
};

/** Adds a lesson to its workflow's file, or says why it can't. */
export const addLesson = (ask: LessonAsk): LessonResult => {
  if (ask.text.trim() === "") {
    return { ok: false, error: "The lesson is empty." };
  }
  const current = existsSync(ask.file)
    ? readFileSync(ask.file, "utf8")
    : `# Lessons for ${ask.workflow}\n\n`;
  if (current.includes(lessonMark(ask.item))) {
    return {
      ok: false,
      error: `${ask.item.slice(0, 12)} is already a lesson in ${ask.shownAs}.`,
    };
  }
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  const next = `${current}${separator}${entryOf(ask.text, ask.item)}`;
  const tokens = estimateTokens(next);
  if (tokens > LESSON_CAP_TOKENS) {
    return {
      ok: false,
      error: `${ask.shownAs} would be about ${tokens.toLocaleString("en")} tokens, over the ${LESSON_CAP_TOKENS.toLocaleString("en")} a session loads. Edit it to make room, then accept again.`,
    };
  }
  mkdirSync(path.dirname(ask.file), { recursive: true });
  writeFileSync(ask.file, next);
  return { ok: true, tokens };
};
