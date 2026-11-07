/**
 * @file Which of the feedback loop's actions an item allows, and why not: one
 *   rule for `ork feedback` and the Feedback panel, so the two never disagree.
 *   It reads only the item's target, status and workflows; whether its project
 *   is still there is asked where a project is needed (`placeOf`).
 */

import type { FeedbackItem } from "../store/feedback-types.ts";
import type { EventStore } from "../store/types.ts";

/** Allowed, or why not: `why` short, for a button; `error` a sentence. */
export type ActionCheck =
  | { ok: true }
  | { ok: false; why: string; error: string };

export type FeedbackActions = {
  /** Mark it accepted. */
  accept: ActionCheck;
  /** Write it as a lesson for a workflow it was seen in. */
  lesson: ActionCheck;
  /** Have `ork:feedback-apply` propose a fix. */
  apply: ActionCheck;
  /** Share it with Ork's maintainers. */
  publish: ActionCheck;
};

const ALLOWED: ActionCheck = { ok: true };

const no = (why: string, error: string): ActionCheck => ({
  ok: false,
  why,
  error,
});

/** A dismissed item allows nothing until it's restored. */
const dismissed = (short: string): ActionCheck =>
  no("dismissed; restore it first", `${short} is dismissed; restore it first.`);

const already = (short: string, status: string): ActionCheck =>
  no(`${status} already`, `${short} is ${status} already.`);

/**
 * `fixRun` is a running `ork:feedback-apply` run for the item ({@link
 * openFixRun}): a second fix isn't started beside it.
 */
export const feedbackActions = (
  item: FeedbackItem,
  fixRun?: string,
): FeedbackActions => {
  const short = item.id.slice(0, 12);
  const isOrk = item.target === "ork";
  if (item.status === "dismissed") {
    const check = dismissed(short);
    return { accept: check, lesson: check, apply: check, publish: check };
  }
  const settled = item.status === "resolved" || item.status === "published";
  const accept =
    item.status === "accepted" || settled
      ? already(short, item.status)
      : ALLOWED;
  let lesson: ActionCheck = ALLOWED;
  if (isOrk) {
    lesson = no(
      "about Ork itself",
      `${short} is about Ork itself, so it isn't a lesson for a workflow; share it with Ork's maintainers instead.`,
    );
  } else if (item.workflows.length === 0) {
    lesson = no(
      "no workflow recorded, so no lessons file",
      `No workflow is recorded for ${short}, so it has no lessons file.`,
    );
  }
  let apply: ActionCheck = ALLOWED;
  if (isOrk) {
    apply = no(
      "about Ork itself",
      `${short} is about Ork itself, so its fix isn't in this project; share it with Ork's maintainers instead.`,
    );
  } else if (settled) {
    apply = already(short, item.status);
  } else if (fixRun !== undefined) {
    apply = no(
      `run ${fixRun} is proposing a fix`,
      `Run ${fixRun} is proposing a fix for ${short} already: answer its question in \`ork decide\` or the UI, or stop it first.`,
    );
  }
  let publish: ActionCheck = ALLOWED;
  if (!isOrk) {
    publish = no(
      "only feedback about Ork is shared",
      `${short} is about this ${item.target}, not Ork itself: only feedback about Ork is shared, and the rest stays on your machine.`,
    );
  } else if (item.status === "published") {
    publish = already(short, item.status);
  }
  return { accept, lesson, apply, publish };
};

/** What a run of `ork:feedback-apply` is named: its file's `name:`. */
export const FIX_WORKFLOW = "ork-feedback-apply";

/** The running `ork:feedback-apply` run proposing a fix for `item`, if any. */
export const openFixRun = (
  store: EventStore,
  item: FeedbackItem,
): string | undefined => {
  const short = item.id.slice(0, 12);
  return store
    .runs()
    .filter(run => run.workflow === FIX_WORKFLOW && run.status === "running")
    .find(run => {
      const [first] = store.events(run.id);
      const event = first?.event;
      return event?.type === "run.started" && event.inputs?.["item"] === short;
    })?.id;
};
