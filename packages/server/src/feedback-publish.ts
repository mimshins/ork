/**
 * @file Publishing an `ork` item from the Feedback panel (ADR-059): the preview
 *   shows exactly what would be sent and where, with a digest of it; the
 *   publish makes the preview again and sends it only when its digest is the
 *   one the person saw, with their own `gh` login.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";

import {
  DISCUSSIONS,
  type FeedbackItem,
  planPost,
  previewPost,
  runGh,
  sendPost,
} from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import type { PublishPreview } from "./contract-feedback.ts";
import { fail } from "./router.ts";

type Refused = {
  ok: false;
  refusal: { status: 400 | 404 | 409; error: string };
};

const refused = (status: 400 | 409, error: string): Refused => ({
  ok: false,
  refusal: fail(status, error),
});

/** The preview of `item`'s post, and its digest, or why there's none. */
export const previewOf = async (
  context: ServerContext,
  item: FeedbackItem,
  hideNames: boolean,
): Promise<{ ok: true; preview: PublishPreview } | Refused> => {
  const shown = previewPost(context.store, item, {
    home: context.home ?? homedir(),
    registered: context.store.projects(),
    hideNames,
  });
  if (!shown.ok) return refused(409, shown.error);
  const planned = await planPost(shown.post, context.gh ?? runGh);
  if (!planned.ok) return refused(400, planned.error);
  const digest = createHash("sha256")
    .update(JSON.stringify([shown.post, planned.plan]))
    .digest("hex");
  return {
    ok: true,
    preview: {
      post: shown.post,
      plan: planned.plan,
      repo: `${DISCUSSIONS.owner}/${DISCUSSIONS.name}`,
      digest,
    },
  };
};

/** Sends `item`'s post when it's still the one previewed as `digest`. */
export const sendPublish = async (
  context: ServerContext,
  item: FeedbackItem,
  ask: { hideNames: boolean; digest: string },
): Promise<
  { ok: true; url: string; kind: "created" | "commented" } | Refused
> => {
  const previewed = await previewOf(context, item, ask.hideNames);
  if (!previewed.ok) return previewed;
  const { post, plan, digest } = previewed.preview;
  if (digest !== ask.digest) {
    return refused(
      409,
      "What would be sent changed after the preview, so nothing was sent: look at the preview again.",
    );
  }
  const sent = await sendPost(post, plan, context.gh ?? runGh);
  if (!sent.ok) return refused(400, sent.error);
  context.store.setFeedbackStatus(item.id, "published");
  return { ok: true, url: sent.url, kind: sent.kind };
};
