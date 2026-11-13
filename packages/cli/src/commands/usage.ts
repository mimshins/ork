/**
 * @file `ork usage` and `ork prune` (specs/usage.md): what runs spent over
 *   time, from the store's ledger, and forgetting old runs' transcripts while
 *   keeping that ledger.
 */

import {
  agoTime,
  ALL,
  applyPrune,
  openStore,
  placeFor,
  planPrune,
  USAGE_DIMENSIONS,
  type UsageDimension,
  usageListTable,
  usageReport,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import {
  filterArgs,
  projectScope,
  readListArgs,
  refuseUnknownFlags,
} from "../list/flags.ts";
import { confirm, style, write, writeErr } from "../output.ts";
import { limitsHere } from "../run/limits.ts";
import { formatLimits, formatUsage } from "../runs/usage.ts";

const isDimension = (value: string): value is UsageDimension =>
  USAGE_DIMENSIONS.some(dimension => dimension === value);

const refuse = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

export const usage = defineCommand({
  meta: {
    name: "usage",
    description: "Show what this project's runs spent over time",
  },
  plugins: [refuseUnknownFlags],
  args: filterArgs(usageListTable, {
    ids: false,
    limit: false,
    extra: {
      "clear-plan-limits": {
        type: "boolean",
        description:
          "Forget what Claude Code last said of your plan's limits, for one that has lifted",
        default: false,
      },
      by: { type: "string", description: USAGE_DIMENSIONS.join(", ") },
    },
  }),
  run: ({ args }) => {
    // Thirty days unless `--since` says otherwise.
    const asked: unknown = args["since"];
    const since = typeof asked === "string" ? asked : "30d";
    const request = readListArgs(usageListTable, { ...args, since });
    if (request === undefined) return;
    const rawBy: unknown = args["by"];
    const given = typeof rawBy === "string" ? rawBy : undefined;
    if (given !== undefined && !isDimension(given)) {
      refuse(
        `--by takes one of ${USAGE_DIMENSIONS.join(", ")}, not \`${given}\`.`,
      );
      return;
    }
    const by = given;
    const store = openStore();
    try {
      const scope = projectScope(request.filter, store.projects());
      if (scope === undefined) return;
      // `projectScope` found a named project among these, so the lookup hits.
      const named = typeof scope === "object" ? scope.root : undefined;
      const place =
        scope === "here"
          ? placeFor(process.cwd(), store.projects())
          : store.projects().find(p => p.root === named);
      const { workflow, until, since: from } = request.filter;
      if (args["clear-plan-limits"] === true) {
        const cleared = store.clearPlanLimits();
        const said =
          cleared === 0
            ? "No plan limit was recorded."
            : `Cleared ${String(cleared)} plan limit(s).`;
        // Stdout is the JSON report under --json.
        (args["json"] === true ? writeErr : write)(said);
      }
      const filter = {
        ...(place === undefined ? {} : { project: place.root }),
        ...(workflow === undefined ? {} : { workflow }),
        ...(from === undefined || from === ALL ? {} : { since: from }),
        ...(until === undefined ? {} : { until }),
      };
      const report = usageReport(store.usage(filter), store.toolCpu(filter));
      const limits = limitsHere(store, place);
      if (args["json"] === true) {
        write(JSON.stringify({ ...report, limits }, undefined, 2));
        return;
      }
      for (const line of formatLimits(limits)) write(line);
      const where =
        scope === "here"
          ? "this project"
          : scope === "all"
            ? "every project"
            : `project ${String(request.filter["project"])}`;
      const period = since === "all" ? "" : `, since ${since}`;
      for (const line of formatUsage(report, `${where}${period}`, by)) {
        write(line);
      }
    } finally {
      store.close();
    }
  },
});

export const prune = defineCommand({
  meta: {
    name: "prune",
    description: "Forget old runs' transcripts; what they spent stays",
  },
  args: {
    "older-than": {
      type: "string",
      description: "Runs that ended this long ago: 90d, 12w",
      required: true,
    },
    all: {
      type: "boolean",
      description: "Every project's runs",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would go, and change nothing",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Do not ask",
      default: false,
    },
  },
  run: async ({ args }) => {
    const before = agoTime(args["older-than"], Date.now());
    if (before === null) {
      refuse(
        `--older-than takes an age (90d, 12w), not \`${args["older-than"]}\`.`,
      );
      return;
    }
    const store = openStore();
    try {
      const filter = {
        before,
        ...(args.all
          ? {}
          : { project: placeFor(process.cwd(), store.projects()).root }),
      };
      const plan = await planPrune(store, filter);
      for (const { run, reason } of plan.keep) {
        write(style("dim", `keep ${run.id} (${run.workflow}): ${reason}`));
      }
      for (const run of plan.remove) {
        write(
          `${args["dry-run"] ? "would remove" : "remove"} ${run.id} (${run.workflow}, ${run.startedAt.slice(0, 10)})`,
        );
      }
      if (plan.remove.length === 0) {
        write("Nothing to prune.");
        return;
      }
      if (args["dry-run"]) return;
      const count = String(plan.remove.length);
      const question = `Forget ${count} run(s) and their logs for good? They can no longer be resumed or read. [y/N] `;
      if (!args.yes && !(await confirm(question))) return;
      // Something may have started while the question waited.
      const agreed = new Set(plan.remove.map(run => run.id));
      const outcome = applyPrune(store, {
        remove: (args.yes
          ? plan
          : await planPrune(store, filter)
        ).remove.filter(run => agreed.has(run.id)),
      });
      const notShrunk = store.compact();
      write(
        `Removed ${String(outcome.removed)} run(s) and ${String(outcome.folders)} folder(s). Their usage stays in \`ork usage\`.${notShrunk === null ? "" : ` The store's file did not shrink: ${notShrunk}. The next prune tries again, and its free space is used first.`}`,
      );
      for (const { run, reason } of outcome.failed) {
        refuse(`Run ${run}: ${reason}.`);
      }
    } finally {
      store.close();
    }
  },
});
