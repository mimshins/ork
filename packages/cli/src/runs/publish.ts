/**
 * @file `ork feedback publish`'s words (ADR-059): what will be sent, as the
 *   person reads it before saying yes.
 */

import type { Post, PostPlan } from "@krapht/ork-core";

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
