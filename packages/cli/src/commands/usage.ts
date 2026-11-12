/**
 * @file `ork usage` and `ork prune` (specs/usage.md): what runs spent over
 *   time, from the store's ledger, and forgetting old runs' transcripts while
 *   keeping that ledger.
 */

import {
  applyPrune,
  openStore,
  placeFor,
  planPrune,
  USAGE_DIMENSIONS,
  type UsageDimension,
  usageReport,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, style, write, writeErr } from "../output.ts";
import { limitsHere } from "../run/limits.ts";
import {
  agoTime,
  formatLimits,
  formatUsage,
  sinceTime,
  untilTime,
} from "../runs/usage.ts";

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
  args: {
    all: {
      type: "boolean",
      description: "Every project's runs",
      default: false,
    },
    "clear-plan-limits": {
      type: "boolean",
      description:
        "Forget what Claude Code last said of your plan's limits, for one that has lifted",
      default: false,
    },
    since: {
      type: "string",
      description:
        "Whole days counting today (30d, 12w), exact hours (24h), a day (2026-11-01), or all",
      default: "30d",
    },
    until: { type: "string", description: "The last day to include" },
    by: { type: "string", description: USAGE_DIMENSIONS.join(", ") },
    workflow: { type: "string", description: "Only this workflow" },
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) => {
    const since =
      args.since === "all" ? undefined : sinceTime(args.since, Date.now());
    const until = args.until === undefined ? undefined : untilTime(args.until);
    if (since === null) {
      refuse(
        `--since takes an age (30d), a day (2026-11-01) or all, not \`${args.since}\`.`,
      );
      return;
    }
    if (until === null) {
      refuse(
        `--until takes a day (2026-11-01), not \`${String(args.until)}\`.`,
      );
      return;
    }
    if (args.by !== undefined && !isDimension(args.by)) {
      refuse(
        `--by takes one of ${USAGE_DIMENSIONS.join(", ")}, not \`${args.by}\`.`,
      );
      return;
    }
    const store = openStore();
    try {
      if (args["clear-plan-limits"]) {
        const cleared = store.clearPlanLimits();
        const said =
          cleared === 0
            ? "No plan limit was recorded."
            : `Cleared ${String(cleared)} plan limit(s).`;
        // Stdout is the JSON report under --json.
        (args.json ? writeErr : write)(said);
      }
      const filter = {
        ...(args.all
          ? {}
          : { project: placeFor(process.cwd(), store.projects()).root }),
        ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
        ...(since === undefined ? {} : { since }),
        ...(until === undefined ? {} : { until }),
      };
      const report = usageReport(store.usage(filter), store.toolCpu(filter));
      const limits = limitsHere(
        store,
        args.all ? undefined : placeFor(process.cwd(), store.projects()),
      );
      if (args.json) {
        write(JSON.stringify({ ...report, limits }, undefined, 2));
        return;
      }
      for (const line of formatLimits(limits)) write(line);
      const place = args.all ? "every project" : "this project";
      const period = args.since === "all" ? "" : `, since ${args.since}`;
      for (const line of formatUsage(report, `${place}${period}`, args.by)) {
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
