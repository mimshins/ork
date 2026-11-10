/**
 * @file `ork ps`, `ork logs` and `ork tree`: read what every project's runs
 *   recorded in `~/.ork/state.db` (specs/event-store.md).
 */

import {
  activeTree,
  findRun,
  nestItems,
  placeFor,
  runStatus,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write, writeErr } from "../output.ts";
import { cost, formatRuns, formatTree } from "../runs/format.ts";
import { followRun, unknownNode } from "../runs/logs.ts";
import { withStore } from "../store.ts";

export { feedback } from "./feedback.ts";

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
      const statusOf = (run: (typeof runs)[number]) =>
        runStatus(
          run,
          run.status === "running"
            ? store.events(run.id).map(s => s.event)
            : [],
        );
      if (args.json) write(JSON.stringify(runs, undefined, 2));
      else {
        for (const line of formatRuns(runs, args.all, Date.now(), statusOf)) {
          write(line);
        }
      }
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
    verbose: {
      type: "boolean",
      description:
        "Show why each failed node stopped, with its scrubbed details (always on with --node)",
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
      const problem =
        args.node === undefined
          ? null
          : unknownNode(
              store.events(found.run.id),
              args.node,
              args.follow && found.run.status === "running",
            );
      if (problem !== null) {
        writeErr(problem);
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
        verbose: args.verbose,
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
      const stored = store.events(run.id);
      const events = stored.map(s => s.event);
      const roots = nestItems(activeTree(stored));
      if (args.json) {
        write(JSON.stringify(roots, undefined, 2));
        return;
      }
      write(
        `${style("bold", `run ${run.id}`)} ${style("dim", `of ${run.workflow} · ${runStatus(run, events)} · ${cost(run.costUsd)}`)}`,
      );
      for (const line of formatTree(roots)) write(line);
    }),
});
