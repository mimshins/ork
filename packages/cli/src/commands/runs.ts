/**
 * @file `ork ps`, `ork logs` and `ork tree`: read what every project's runs
 *   recorded in `~/.ork/state.db` (specs/event-store.md).
 */

import {
  activeTree,
  ALL,
  applyFilters,
  findRun,
  nestItems,
  placeFor,
  type ProjectRecord,
  type RunListRow,
  runListTable,
  type RunRecord,
  runStatus,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  filterArgs,
  type ProjectScope,
  projectScope,
  readListArgs,
  refuseUnknownFlags,
} from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { write, writeErr } from "../output.ts";
import { formatRuns, formatTreeView, listedStatus } from "../runs/format.ts";
import { followRun, logListTable, unknownNode } from "../runs/logs.ts";
import { withStore } from "../store.ts";

export { feedback } from "./feedback.ts";

/** How many runs `ork ps` shows without `--limit`. */
const PS_LIMIT = 20;

/** The project root a scope other than `all` names. */
const rootOf = (
  scope: Exclude<ProjectScope, "all">,
  projects: readonly ProjectRecord[],
): string =>
  scope === "here" ? placeFor(process.cwd(), projects).root : scope.root;

export const ps = defineCommand({
  meta: { name: "ps", description: "List this project's runs, newest first" },
  plugins: [refuseUnknownFlags],
  args: {
    ...filterArgs(runListTable, {
      extra: {
        limit: {
          type: "string",
          description: `Show at most this many, a positive whole number (default ${String(PS_LIMIT)})`,
        },
      },
    }),
  },
  run: ({ args }) =>
    withStore(store => {
      const req = readListArgs(runListTable, args);
      if (req === undefined) return;
      const scope = projectScope(req.filter, store.projects());
      if (scope === undefined) return;
      const stored = store.runs(
        scope === ALL ? {} : { project: rootOf(scope, store.projects()) },
      );
      // A running run's events are read only when `--status` needs them.
      const rows: RunListRow[] =
        req.filter["status"] === undefined
          ? stored
          : stored.map(run =>
              run.status === "running"
                ? {
                    ...run,
                    listed: runStatus(
                      run,
                      store.events(run.id).map(s => s.event),
                    ),
                  }
                : run,
            );
      const shown = applyFilters(runListTable, rows, req.filter).slice(
        0,
        req.limit ?? PS_LIMIT,
      );
      const byId = new Map(stored.map(run => [run.id, run]));
      const statusOf = (run: RunRecord) =>
        listedStatus(
          run,
          run.status === "running"
            ? store.events(run.id).map(s => s.event)
            : [],
        );
      printList(
        shown,
        runListTable,
        { ids: args["ids"], json: args["json"] },
        runs => {
          for (const line of formatRuns(
            runs,
            scope === ALL,
            Date.now(),
            statusOf,
          )) {
            write(line);
          }
        },
        // The stored records, without the `listed` the filter added, and
        // `live`: the status the table shows (`status` stays as stored).
        runs =>
          runs.map(run => {
            const record = byId.get(run.id) ?? run;
            return { ...record, live: statusOf(record) };
          }),
      );
    }),
});

const runArg = {
  type: "positional",
  description: "A run id or a prefix of one (default: this project's newest)",
  required: false,
} as const;

export const logs = defineCommand({
  meta: { name: "logs", description: "Print a run's transcript" },
  plugins: [refuseUnknownFlags],
  args: {
    run: runArg,
    ...filterArgs(logListTable, { ids: false, json: false, limit: false }),
    limit: {
      type: "string",
      description:
        "Print only the last this many stored events, a positive whole number (a live follow goes on past it)",
    },
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
        "Show each tool call whole, and why each failed node stopped, with its scrubbed details (always on with --node)",
      default: false,
    },
  },
  run: ({ args }) =>
    withStore(async store => {
      const req = readListArgs(logListTable, args);
      if (req === undefined) return;
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
        filter: req.filter,
        ...(req.limit === undefined ? {} : { limit: req.limit }),
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
      for (const line of formatTreeView(run, events, roots)) write(line);
    }),
});
