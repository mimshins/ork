/**
 * @file Accepting a feedback item (`ork feedback accept`, the Feedback panel):
 *   marks an item accepted and, with `--lesson`, writes it as a lesson into the
 *   lessons file of the workflow it was seen in, in the project of its newest
 *   record there (ADR-059). An `ork` item is about Ork itself, so it's never a
 *   lesson: it can be published instead.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { inside } from "../context/files.ts";
import { estimateTokens, LESSON_CAP_TOKENS } from "../context/lesson-cap.ts";
import { placeFor, type ProjectPlace } from "../project/place.ts";
import { guardedBase } from "../project/plain-files.ts";
import type { FeedbackItem } from "../store/feedback-types.ts";
import type { EventStore } from "../store/types.ts";
import { feedbackActions } from "./actions.ts";
import { addLesson, lessonsFileOf } from "./lessons.ts";

export type AcceptArgs = {
  lesson: boolean;
  /** The lesson's words; the item's title by default. */
  text?: string | undefined;
  /** Which workflow's lessons, when it was seen in more than one. */
  workflow?: string | undefined;
};

/** Where a lesson went: its file as shown, the project, and its size. */
export type LessonWritten = {
  /** Project-relative, or whole when it's outside the project. */
  file: string;
  root: string;
  workflow: string;
  /** About how many tokens the whole file is now. */
  tokens: number;
};

export type Accepted =
  | { ok: true; lines: string[]; lesson?: LessonWritten }
  | { ok: false; error: string };

const listed = (names: readonly string[]): string =>
  names.map(n => `\`${n}\``).join(", ");

/** The workflow a lesson is for: the one named, or the only one it was seen in. */
const workflowFor = (
  item: FeedbackItem,
  named: string | undefined,
): { ok: true; workflow: string } | { ok: false; error: string } => {
  if (named !== undefined) {
    return item.workflows.includes(named)
      ? { ok: true, workflow: named }
      : {
          ok: false,
          error: `${item.id.slice(0, 12)} wasn't seen in \`${named}\`, only in ${listed(item.workflows)}.`,
        };
  }
  const [only, other] = item.workflows;
  if (only === undefined) {
    return {
      ok: false,
      error: `No workflow is recorded for ${item.id.slice(0, 12)}, so it has no lessons file.`,
    };
  }
  return other === undefined
    ? { ok: true, workflow: only }
    : {
        ok: false,
        error: `${item.id.slice(0, 12)} was seen in ${listed(item.workflows)}: name one with --workflow.`,
      };
};

const real = (dir: string): string => {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

export type FoundPlace =
  | {
      ok: true;
      place: ProjectPlace;
      /** The project root as the item's runs recorded it. */
      project: string;
    }
  | { ok: false; error: string };

/**
 * The project of the item's newest record (in `workflow`, when given): the
 * folder its run started in, when that's still the same project. A clone that
 * was deleted is refused, never taken for a repository above it.
 */
export const placeOf = (
  store: EventStore,
  item: FeedbackItem,
  workflow: string | undefined,
  registered: readonly ProjectPlace[],
): FoundPlace => {
  const record = store
    .feedbackRecords(item.id)
    .findLast(
      r => workflow === undefined || r.feedback.origin.workflow === workflow,
    );
  const [run] = record === undefined ? [] : store.lookup(record.runId);
  if (run === undefined) {
    return {
      ok: false,
      error: `The runs ${item.id.slice(0, 12)} was seen in are gone, so its project isn't known.`,
    };
  }
  if (!existsSync(run.project)) {
    return { ok: false, error: `Its project at ${run.project} is gone.` };
  }
  const folder = path.dirname(run.file);
  const place = placeFor(existsSync(folder) ? folder : run.project, registered);
  return real(place.root) === real(run.project)
    ? { ok: true, place, project: run.project }
    : {
        ok: false,
        error: `Its project at ${run.project} isn't a project any more: Ork would take it for ${place.root}.`,
      };
};

/** Accepts `item`, as a lesson with `--lesson`. */
export const acceptItem = (
  store: EventStore,
  item: FeedbackItem,
  args: AcceptArgs,
  registered: readonly ProjectPlace[],
): Accepted => {
  const name = `${item.id.slice(0, 12)}: ${item.title}`;
  const actions = feedbackActions(item);
  if (!args.lesson) {
    if (!actions.accept.ok) return { ok: false, error: actions.accept.error };
    store.setFeedbackStatus(item.id, "accepted");
    return { ok: true, lines: [`accepted ${name}`] };
  }
  if (!actions.lesson.ok) return { ok: false, error: actions.lesson.error };
  const chosen = workflowFor(item, args.workflow);
  if (!chosen.ok) return chosen;
  const found = placeOf(store, item, chosen.workflow, registered);
  if (!found.ok) return found;
  const { place } = found;
  const file = lessonsFileOf(place, chosen.workflow);
  const shownAs = inside(place.root, file)
    ? path.relative(place.root, file)
    : file;
  const added = addLesson({
    file,
    base: guardedBase(place),
    shownAs,
    workflow: chosen.workflow,
    item: item.id,
    text: args.text ?? item.title,
  });
  if (!added.ok) return added;
  // A lesson for an item settled already leaves its status as it is.
  if (actions.accept.ok) store.setFeedbackStatus(item.id, "accepted");
  return {
    ok: true,
    lesson: {
      file: shownAs,
      root: place.root,
      workflow: chosen.workflow,
      tokens: added.tokens,
    },
    lines: [
      `accepted ${name}`,
      `lesson added to ${shownAs} in ${place.root} (about ${added.tokens.toLocaleString("en")} of ${LESSON_CAP_TOKENS.toLocaleString("en")} tokens); every session of \`${chosen.workflow}\` reads it from now on`,
    ],
  };
};

/** Where a lesson for `workflow` would go, and how big that file is now. */
export type LessonPlace =
  | {
      ok: true;
      workflow: string;
      /** Project-relative, or whole when it's outside the project. */
      file: string;
      root: string;
      /** About how many tokens the file is; 0 when it isn't there yet. */
      tokens: number;
      exists: boolean;
    }
  | { ok: false; workflow: string; error: string };

export const lessonPlaceOf = (
  store: EventStore,
  item: FeedbackItem,
  workflow: string,
  registered: readonly ProjectPlace[],
): LessonPlace => {
  const found = placeOf(store, item, workflow, registered);
  if (!found.ok) return { ok: false, workflow, error: found.error };
  const { place } = found;
  const file = lessonsFileOf(place, workflow);
  const exists = existsSync(file);
  return {
    ok: true,
    workflow,
    file: inside(place.root, file) ? path.relative(place.root, file) : file,
    root: place.root,
    tokens: exists ? estimateTokens(readFileSync(file, "utf8")) : 0,
    exists,
  };
};
