/**
 * @file The preview of an `ork` item as a post to Ork's Discussions (ADR-059),
 *   for `ork feedback publish` and the Feedback panel. The projects its records
 *   came from and every registered one are rewritten to `<project>`, and when
 *   names are hidden their folders' and the workflows' names go too. What the
 *   person confirms is what is sent.
 */

import path from "node:path";

import type { ProjectPlace } from "../project/place.ts";
import type { FeedbackItem } from "../store/feedback-types.ts";
import type { EventStore } from "../store/types.ts";
import { feedbackActions } from "./actions.ts";
import { type Post, publishPost } from "./redact.ts";

export type PreviewAsk = {
  home: string;
  registered: readonly ProjectPlace[];
  hideNames: boolean;
};

/** The item as a post, or why it isn't shared. */
export const previewPost = (
  store: EventStore,
  item: FeedbackItem,
  ask: PreviewAsk,
): { ok: true; post: Post } | { ok: false; error: string } => {
  const allowed = feedbackActions(item).publish;
  if (!allowed.ok) return { ok: false, error: allowed.error };
  const records = store.feedbackRecords(item.id);
  const runRoots = records.flatMap(
    r => store.lookup(r.runId).find(run => run.id === r.runId)?.project ?? [],
  );
  const roots = [...new Set([...runRoots, ...ask.registered.map(p => p.root)])];
  const names = ask.hideNames
    ? [...item.workflows, ...roots.map(root => path.basename(root))]
    : [];
  return {
    ok: true,
    post: publishPost(item, records, { roots, home: ask.home, names }),
  };
};
