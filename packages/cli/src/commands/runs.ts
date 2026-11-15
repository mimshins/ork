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
  type RunListRow,
  runListTable,
  type RunRecord,
  runStatus,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  filterArgs,
  projectScope,
  readListArgs,
  refuseUnknownFlags,
  rootOf,
} from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { write, writeErr } from "../output.ts";
import { formatRuns, formatTreeView, listedStatus } from "../runs/format.ts";
import { withStore } from "../store.ts";

export { feedback } from "./feedback.ts";
export { logs } from "./logs.ts";

/** How many runs `ork ps` shows without `--limit`. */
const PS_LIMIT = 20;

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

export const tree = defineCommand({
  meta: {
    name: "tree",
    description:
      "Show a run's ownership tree with status, tokens and cost. A delegated task shows its task label: the lead's short description, whitespace folded, clipped to 80 characters, secrets masked",
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
