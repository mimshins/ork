/**
 * @file `ork feedback`: the feedback every run recorded, grouped into items
 *   (specs/feedback.md): list and show them, note a run, dismiss and restore an
 *   item, and accept one, as a lesson its workflow reads from then on. What
 *   closes the loop further (apply, triage, split) is in `feedback-loop.ts`,
 *   and what moves feedback off the machine (publish, export, import) in
 *   `feedback-share.ts`.
 */

import type { EventStore, FeedbackItem } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import { registeredProjects } from "../project/place.ts";
import { acceptItem } from "../runs/accept.ts";
import {
  findFeedbackItem,
  formatFeedbackItem,
  formatFeedbackItems,
  noteRun,
} from "../runs/feedback.ts";
import { withStore } from "../store.ts";
import { apply, split, triage } from "./feedback-loop.ts";
import { exportFeedback, importFeedback, publish } from "./feedback-share.ts";

/** Runs `body` on the item `prefix` names, or says why there's none. */
const withItem = (
  prefix: string,
  body: (store: EventStore, item: FeedbackItem) => void,
): Promise<void> =>
  withStore(store => {
    const found = findFeedbackItem(store, prefix);
    if (!found.ok) {
      writeErr(found.error);
      process.exitCode = 1;
      return;
    }
    body(store, found.item);
  });

const itemArg = {
  type: "positional",
  description: "A feedback item's id, or a prefix of one",
  required: true,
} as const;

const json = {
  type: "boolean",
  description: "Print JSON",
  default: false,
} as const;

export const feedback = defineCommand({
  meta: {
    name: "feedback",
    description:
      "What got in the way in your runs, grouped: list, show, note, triage, accept, apply, publish, export, import",
  },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List feedback items, newest first" },
      args: {
        all: {
          type: "boolean",
          description: "Dismissed items too",
          default: false,
        },
        json,
      },
      run: ({ args }) =>
        withStore(store => {
          const items = store.feedbackItems({ all: args.all });
          if (args.json) write(JSON.stringify(items, undefined, 2));
          else for (const line of formatFeedbackItems(items)) write(line);
        }),
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show an item and its records" },
      args: { item: itemArg, json },
      run: ({ args }) =>
        withItem(args.item, (store, item) => {
          const records = store.feedbackRecords(item.id);
          if (args.json) {
            write(JSON.stringify({ ...item, records }, undefined, 2));
            return;
          }
          for (const line of formatFeedbackItem(item, records)) write(line);
        }),
    }),
    note: defineCommand({
      meta: {
        name: "note",
        description:
          "Note how a run or one of its nodes went; it joins the feedback",
      },
      args: {
        run: {
          type: "positional",
          description: "A run id or a prefix of one",
          required: true,
        },
        node: {
          type: "positional",
          description: "One of its nodes",
          required: false,
        },
        message: {
          type: "string",
          alias: "m",
          description: "The note; its first line is the title",
          required: true,
        },
        kind: { type: "string", description: "friction (default), bug, …" },
        severity: { type: "string", description: "low, medium or high" },
        rating: { type: "string", description: "good or bad" },
      },
      run: ({ args }) =>
        withStore(store => {
          const noted = noteRun(store, process.cwd(), {
            ...args,
            text: args.message,
          });
          if (noted.ok) {
            write(`${style("green", "✓")} noted in item ${noted.item}`);
            return;
          }
          writeErr(noted.error);
          process.exitCode = 1;
        }),
    }),
    accept: defineCommand({
      meta: {
        name: "accept",
        description:
          "Accept an item; with --lesson, every later session of its workflow reads it",
      },
      args: {
        item: itemArg,
        lesson: {
          type: "boolean",
          description:
            "Add it to the workflow's lessons (.ork/lessons/<workflow>.md)",
          default: false,
        },
        message: {
          type: "string",
          alias: "m",
          description: "The lesson's words (default: the item's title)",
        },
        workflow: {
          type: "string",
          description: "Whose lessons, when it was seen in more than one",
        },
      },
      run: ({ args }) =>
        withItem(args.item, (store, item) => {
          const accepted = acceptItem(
            store,
            item,
            {
              lesson: args.lesson,
              text: args.message,
              workflow: args.workflow,
            },
            registeredProjects(),
          );
          if (!accepted.ok) {
            writeErr(accepted.error);
            process.exitCode = 1;
            return;
          }
          const [first, ...rest] = accepted.lines;
          write(`${style("green", "✓")} ${first ?? ""}`);
          for (const line of rest) write(`  ${line}`);
        }),
    }),
    apply,
    triage,
    split,
    publish,
    export: exportFeedback,
    import: importFeedback,
    dismiss: defineCommand({
      meta: {
        name: "dismiss",
        description: "Dismiss an item: it leaves the list, and stays dismissed",
      },
      args: { item: itemArg },
      run: ({ args }) =>
        withItem(args.item, (store, item) => {
          store.setFeedbackStatus(item.id, "dismissed");
          write(`${style("green", "✓")} dismissed ${item.id}: ${item.title}`);
        }),
    }),
    restore: defineCommand({
      meta: {
        name: "restore",
        description: "Bring a dismissed item back to the list, as new",
      },
      args: { item: itemArg },
      run: ({ args }) =>
        withItem(args.item, (store, item) => {
          store.setFeedbackStatus(item.id, "new");
          write(`${style("green", "✓")} restored ${item.id}: ${item.title}`);
        }),
    }),
  },
});
