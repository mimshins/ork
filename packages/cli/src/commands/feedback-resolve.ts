/**
 * @file `ork feedback resolve`: marks items resolved that were fixed by hand,
 *   outside `ork feedback apply`, so they leave the list (specs/feedback.md).
 *   Takes several ids, space or comma separated, and changes none when one is
 *   unknown or can't be resolved (dismissed, or resolved or published already).
 *   An item seen again after it was resolved opens again.
 */

import { type FeedbackItem, feedbackActions } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import { findFeedbackItem } from "../runs/feedback.ts";
import { withStore } from "../store.ts";

export const resolve = defineCommand({
  meta: {
    name: "resolve",
    description:
      "Mark items fixed by hand resolved: they leave the list, and open again if they recur",
  },
  args: {
    item: {
      type: "positional",
      description:
        "A feedback item's id, or a prefix of one; several allowed, space or comma separated",
      required: true,
    },
  },
  run: ({ args }) =>
    withStore(store => {
      const named = [
        ...new Set(
          args._.flatMap(word => word.split(","))
            .map(word => word.trim())
            .filter(word => word !== ""),
        ),
      ];
      const items = new Map<string, FeedbackItem>();
      const refusals: string[] = [];
      for (const prefix of named) {
        const found = findFeedbackItem(store, prefix);
        if (!found.ok) {
          refusals.push(found.error);
          continue;
        }
        const allowed = feedbackActions(found.item).resolve;
        if (allowed.ok) items.set(found.item.id, found.item);
        else refusals.push(allowed.error);
      }
      if (refusals.length > 0 || items.size === 0) {
        for (const refusal of refusals) writeErr(refusal);
        if (items.size === 0 && refusals.length === 0) {
          writeErr("Give a feedback item's id.");
        }
        process.exitCode = 1;
        return;
      }
      for (const item of items.values()) {
        store.setFeedbackStatus(item.id, "resolved");
        write(
          `${style("green", "✓")} resolved ${item.id.slice(0, 12)}: ${item.title}`,
        );
      }
    }),
});
