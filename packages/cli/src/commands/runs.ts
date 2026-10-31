/**
 * @file `ork ps`, `ork logs`, `ork tree` and `ork feedback`: read what every
 *   project's runs recorded in `~/.ork/state.db` (specs/event-store.md,
 *   specs/feedback.md).
 */

import {
  type EventStore,
  liveStatus,
  openStore,
  runTree,
  placeFor,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import {
  findFeedbackItem,
  formatFeedbackItem,
  formatFeedbackItems,
} from "../runs/feedback.ts";
import { findRun } from "../runs/find.ts";
import { cost, formatRuns, formatTree } from "../runs/format.ts";
import { followRun } from "../runs/logs.ts";

/** Runs `body` with the user's store open, and closes it after. */
const withStore = async (
  body: (store: EventStore) => Promise<void> | void,
): Promise<void> => {
  const store = openStore();
  try {
    await body(store);
  } finally {
    store.close();
  }
};

export const ps = defineCommand({
  meta: { name: "ps", description: "List this project's runs, newest first" },
  args: {
    all: {
      type: "boolean",
      description: "Every project's runs",
      default: false,
    },
    limit: { type: "string", description: "How many (default 20)" },
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) =>
    withStore(store => {
      const limit = Number(args.limit ?? 20);
      const runs = store.runs({
        limit: Number.isInteger(limit) && limit > 0 ? limit : 20,
        ...(args.all
          ? {}
          : { project: placeFor(process.cwd(), store.projects()).root }),
      });
      if (args.json) write(JSON.stringify(runs, undefined, 2));
      else for (const line of formatRuns(runs, args.all)) write(line);
    }),
});

const runArg = {
  type: "positional",
  description: "A run id or a prefix of one (default: this project's newest)",
  required: false,
} as const;

export const logs = defineCommand({
  meta: { name: "logs", description: "Print a run's transcript" },
  args: {
    run: runArg,
    node: { type: "string", description: "Only this node's events" },
    follow: {
      type: "boolean",
      alias: "f",
      description: "Keep printing a live run's events until it ends",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the stored events as JSON lines",
      default: false,
    },
  },
  run: ({ args }) =>
    withStore(async store => {
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      const abort = new AbortController();
      process.once("SIGINT", () => {
        abort.abort();
      });
      await followRun(store, found.run, write, {
        follow: args.follow,
        json: args.json,
        signal: abort.signal,
        ...(args.node === undefined ? {} : { node: args.node }),
      });
    }),
});

export const tree = defineCommand({
  meta: {
    name: "tree",
    description: "Show a run's ownership tree with status, tokens and cost",
  },
  args: {
    run: runArg,
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) =>
    withStore(store => {
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      const { run } = found;
      const roots = runTree(store.events(run.id).map(s => s.event));
      if (args.json) {
        write(JSON.stringify(roots, undefined, 2));
        return;
      }
      write(
        `${style("bold", `run ${run.id}`)} ${style("dim", `of ${run.workflow} · ${liveStatus(run)} · ${cost(run.costUsd)}`)}`,
      );
      for (const line of formatTree(roots)) write(line);
    }),
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
      "What got in the way in your runs, grouped: list, show, dismiss",
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
        withStore(store => {
          const found = findFeedbackItem(store, args.item);
          if (!found.ok) {
            writeErr(found.error);
            process.exitCode = 1;
            return;
          }
          const records = store.feedbackRecords(found.item.id);
          if (args.json) {
            write(JSON.stringify({ ...found.item, records }, undefined, 2));
            return;
          }
          for (const line of formatFeedbackItem(found.item, records)) {
            write(line);
          }
        }),
    }),
    dismiss: defineCommand({
      meta: {
        name: "dismiss",
        description: "Dismiss an item: it leaves the list, and stays dismissed",
      },
      args: { item: itemArg },
      run: ({ args }) =>
        withStore(store => {
          const found = findFeedbackItem(store, args.item);
          if (!found.ok) {
            writeErr(found.error);
            process.exitCode = 1;
            return;
          }
          store.setFeedbackStatus(found.item.id, "dismissed");
          write(
            `${style("green", "✓")} dismissed ${found.item.id}: ${found.item.title}`,
          );
        }),
    }),
  },
});
