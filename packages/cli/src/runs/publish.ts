/**
 * @file `ork feedback publish` (ADR-059): an `ork` item, redacted, as a post to
 *   Ork's Discussions. The projects its records came from and every registered
 *   one are rewritten to `<project>`, and with `--hide-names` their folders'
 *   and the workflows' names go too. What the person confirms is what is sent.
 */

import path from "node:path";

import {
  type EventStore,
  type FeedbackItem,
  type Post,
  type PostPlan,
  publishPost,
  type ProjectPlace,
} from "@krapht/ork-core";

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
  if (item.target !== "ork") {
    return {
      ok: false,
      error: `${item.id.slice(0, 12)} is about this ${item.target}, not Ork itself: only feedback about Ork is shared, and the rest stays on your machine.`,
    };
  }
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

/** What will be sent, as the person reads it before saying yes. */
export const formatPreview = (post: Post, plan: PostPlan): string[] =>
  plan.kind === "comment"
    ? [
        `A thread for this exists (${plan.url}), so this comment goes on it:`,
        "",
        post.comment,
      ]
    : [
        "A new thread in the Agent feedback category of mimshins/ork:",
        "",
        `Title: ${post.title}`,
        "",
        post.body,
      ];
