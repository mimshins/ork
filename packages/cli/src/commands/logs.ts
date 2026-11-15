/**
 * @file `ork logs`: prints a run's transcript (with the runs it called inline),
 *   or follows every live run of a project (`--all`), from `~/.ork/state.db`
 *   (specs/event-store.md, specs/cli.md).
 */

import { ALL, findRun } from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  fail,
  filterArgs,
  projectScope,
  readListArgs,
  refuseUnknownFlags,
  rootOf,
} from "../list/flags.ts";
import { write, writeErr } from "../output.ts";
import { printAll, printCalls, unknownCallNode } from "../runs/logs-many.ts";
import { followRun, logListTable, unknownNode } from "../runs/logs.ts";
import { withStore } from "../store.ts";

const runArg = {
  type: "positional",
  description: "A run id or a prefix of one (default: this project's newest)",
  required: false,
} as const;

/** Why `ork logs`'s flags can't go together, or `null`. */
const logsRefusal = (args: {
  all: boolean;
  follow: boolean;
  run?: string | undefined;
  project?: string | undefined;
  workflow?: string | undefined;
  "until-idle": boolean;
  calls?: boolean | undefined;
  json: boolean;
}): string | null => {
  if (args.all) {
    if (!args.follow) return "--all needs -f.";
    if (args.run !== undefined) return "--all can't be used with a run.";
    if (args.calls !== undefined)
      return "--calls and --no-calls don't apply to --all (a called run prints as its own).";
    return null;
  }
  if (args.project !== undefined) return "--project needs --all.";
  if (args.workflow !== undefined) return "--workflow needs --all.";
  if (args["until-idle"]) return "--until-idle needs --all.";
  return null;
};

export const logs = defineCommand({
  meta: {
    name: "logs",
    description:
      "Print a run's transcript. A delegated task shows its task label: the lead's short description, whitespace folded, clipped to 80 characters, secrets masked",
  },
  plugins: [refuseUnknownFlags],
  args: {
    run: runArg,
    ...filterArgs(logListTable, { ids: false, json: false, limit: false }),
    limit: {
      type: "string",
      description:
        "Print only the last this many stored events, a positive whole number, counted overall in print order, not per run (a live follow goes on past it)",
    },
    node: { type: "string", description: "Only this node's events" },
    follow: {
      type: "boolean",
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
    all: {
      type: "boolean",
      description:
        "With -f: every live run of the project, interleaved, each line behind its run id and workflow (a called run too, once; runs that start later join)",
      default: false,
    },
    project: {
      type: "string",
      description:
        "With --all: a registered project (id or root), or all (default: this one)",
    },
    workflow: {
      type: "string",
      description:
        "With --all: only this workflow's live runs, and the runs they call",
    },
    "until-idle": {
      type: "boolean",
      description: "With --all: end once no live run is left",
      default: false,
    },
    calls: {
      type: "boolean",
      description:
        "Print the runs a run called inline under their call paths (default in text; --no-calls prints the run alone; --json needs --calls to include them)",
      negativeDescription: "Print the run alone, without the runs it called",
    },
  },
  run: ({ args, rawArgs }) =>
    withStore(async store => {
      const both =
        rawArgs.includes("--calls") && rawArgs.includes("--no-calls");
      const refusal = both
        ? "Give --calls or --no-calls, not both."
        : logsRefusal(args);
      if (refusal !== null) {
        fail(refusal);
        return;
      }
      const req = readListArgs(logListTable, args);
      if (req === undefined) return;
      const abort = new AbortController();
      process.once("SIGINT", () => {
        abort.abort();
      });
      if (args.all) {
        const scope = projectScope(
          args.project === undefined ? {} : { project: args.project },
          store.projects(),
        );
        if (scope === undefined) return;
        await printAll(
          store,
          {
            ...(scope === ALL
              ? {}
              : { project: rootOf(scope, store.projects()) }),
            ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
          },
          write,
          {
            json: args.json,
            verbose: args.verbose,
            filter: req.filter,
            ...(req.limit === undefined ? {} : { limit: req.limit }),
            ...(args.node === undefined ? {} : { node: args.node }),
            ...(args["until-idle"] ? { untilIdle: true } : {}),
            signal: abort.signal,
          },
        );
        return;
      }
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      // Called runs print inline in text unless `--no-calls`; JSON only with `--calls`.
      const calls = args.calls ?? !args.json;
      const live = args.follow && found.run.status === "running";
      const problem =
        args.node === undefined
          ? null
          : calls
            ? unknownCallNode(store, found.run.id, args.node, live)
            : unknownNode(store.events(found.run.id), args.node, live);
      if (problem !== null) {
        writeErr(problem);
        process.exitCode = 1;
        return;
      }
      if (calls) {
        await printCalls(store, found.run, write, {
          follow: args.follow,
          json: args.json,
          verbose: args.verbose,
          filter: req.filter,
          ...(req.limit === undefined ? {} : { limit: req.limit }),
          signal: abort.signal,
          ...(args.node === undefined ? {} : { node: args.node }),
        });
        return;
      }
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
