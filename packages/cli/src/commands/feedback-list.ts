/**
 * @file `ork feedback list`: the items, newest first, filtered by the flags
 *   `feedbackListTable` makes (RFC-017). With no `--status` the dismissed ones
 *   stay hidden; `--status all` or a status names what to show.
 */

import { applyFilters, feedbackListTable } from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  filterArgs,
  readListArgs,
  refuseUnknownFlags,
  resolveRun,
} from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { write } from "../output.ts";
import { formatFeedbackItems } from "../runs/feedback.ts";
import { withStore } from "../store.ts";

export const list = defineCommand({
  meta: { name: "list", description: "List feedback items, newest first" },
  plugins: [refuseUnknownFlags],
  args: filterArgs(feedbackListTable),
  run: async ({ args }) => {
    const given: Readonly<Record<string, unknown>> = args;
    const asked = readListArgs(feedbackListTable, given);
    if (asked === undefined) return;
    const { limit } = asked;
    await withStore(store => {
      const filter = resolveRun(store, asked.filter);
      if (filter === undefined) return;
      const items = applyFilters(
        feedbackListTable,
        store.feedbackItems({ all: filter["status"] !== undefined }),
        filter,
      ).slice(0, limit);
      printList(items, feedbackListTable, given, shown => {
        for (const line of formatFeedbackItems(shown)) write(line);
      });
    });
  },
});
