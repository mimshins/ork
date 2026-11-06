/**
 * @file Applying an item from the Feedback panel (ADR-059): the same checks as
 *   `ork feedback apply`, then that command started in the background with a
 *   run id picked here, so the Monitor can follow the run and its gate's keep
 *   or discard settles the item exactly as in a terminal.
 */

import {
  builtinProblem,
  detachRun,
  feedbackActions,
  type FeedbackItem,
  newRunId,
  openFixRun,
  placeOf,
  runDirOf,
} from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import { accepted, fail } from "./router.ts";

const BUILTIN = "ork:feedback-apply";

/** Starts a run proposing a fix for `item`, or says why it can't. */
export const applyRoute = async (
  context: ServerContext,
  item: FeedbackItem,
  driver: "sdk" | "cli" | undefined,
) => {
  const { store } = context;
  const allowed = feedbackActions(item, openFixRun(store, item)).apply;
  if (!allowed.ok) return fail(409, allowed.error);
  const found = placeOf(store, item, undefined, store.projects());
  if (!found.ok) return fail(409, found.error);
  const { place } = found;
  const problem = builtinProblem(place, BUILTIN);
  if (problem !== undefined) return fail(409, problem);
  const runId = newRunId(store);
  const detached = await detachRun({
    store,
    runId,
    args: [
      "feedback",
      "apply",
      item.id,
      "--run-id",
      runId,
      ...(driver === undefined ? [] : ["--driver", driver]),
    ],
    cwd: place.root,
    runDir: runDirOf(place, runId),
    ...(context.script === undefined ? {} : { script: context.script }),
  });
  return detached.ok
    ? accepted({ runId, root: place.root })
    : fail(400, detached.error || "The run did not start.");
};
