/**
 * @file `ork feedback accept`: marks an item accepted and, with `--lesson`,
 *   writes it as a lesson into the lessons file of the workflow it was seen in,
 *   in the project of its newest record there (ADR-059). An `ork` item is about
 *   Ork itself, so it's never a lesson: it can be published instead.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  addLesson,
  type EventStore,
  guardedBase,
  type FeedbackItem,
  inside,
  LESSON_CAP_TOKENS,
  lessonsFileOf,
  placeFor,
  type ProjectPlace,
} from "@krapht/ork-core";

export type AcceptArgs = {
  lesson: boolean;
  /** The lesson's words; the item's title by default. */
  text?: string | undefined;
  /** Which workflow's lessons, when it was seen in more than one. */
  workflow?: string | undefined;
};

export type Accepted =
  | { ok: true; lines: string[] }
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
  if (!args.lesson) {
    store.setFeedbackStatus(item.id, "accepted");
    return { ok: true, lines: [`accepted ${name}`] };
  }
  if (item.target === "ork") {
    return {
      ok: false,
      error: `${item.id.slice(0, 12)} is about Ork itself, so it isn't a lesson for a workflow; share it with Ork's maintainers instead.`,
    };
  }
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
  store.setFeedbackStatus(item.id, "accepted");
  return {
    ok: true,
    lines: [
      `accepted ${name}`,
      `lesson added to ${shownAs} in ${place.root} (about ${added.tokens.toLocaleString("en")} of ${LESSON_CAP_TOKENS.toLocaleString("en")} tokens); every session of \`${chosen.workflow}\` reads it from now on`,
    ],
  };
};
