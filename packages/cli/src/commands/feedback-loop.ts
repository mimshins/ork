/**
 * @file The `ork feedback` subcommands that close the loop (ADR-059): `apply`
 *   runs Ork's own workflow to propose a fix for an item, `triage` merges items
 *   about the same problem by rules after asking, and `split` takes a merge
 *   apart.
 */

import { openStore } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, style, write, writeErr } from "../output.ts";
import { registeredProjects } from "../project/place.ts";
import { applyItem } from "../runs/apply.ts";
import { findFeedbackItem } from "../runs/feedback.ts";
import {
  formatMerge,
  triage as triageItems,
  triageSummary,
} from "../runs/triage.ts";
import { withStore } from "../store.ts";
import {
  badDriver,
  isDriver,
  loadRuntime,
  onInterrupt,
  terminalHuman,
} from "./run.ts";

const itemArg = {
  type: "positional",
  description: "A feedback item's id, or a prefix of one",
  required: true,
} as const;

export const apply = defineCommand({
  meta: {
    name: "apply",
    description:
      "Have Ork propose a fix for an item on a branch, then keep or discard it",
  },
  args: {
    item: itemArg,
    driver: {
      type: "string",
      description: "claude-code (default: the driver ready here)",
    },
    "run-id": {
      type: "string",
      description: "Internal: the id `ork ui` picked for the run",
    },
  },
  run: async ({ args }) => {
    if (args.driver !== undefined && !isDriver(args.driver)) {
      writeErr(badDriver(args.driver));
      process.exitCode = 1;
      return;
    }
    const driver = args.driver;
    const store = openStore();
    const human = terminalHuman();
    try {
      const found = findFeedbackItem(store, args.item);
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      const applied = await applyItem({
        store,
        item: found.item,
        registered: registeredProjects(),
        runtime: loadRuntime,
        ...(human === undefined ? {} : { human }),
        ...(driver === undefined ? {} : { driver }),
        ...(args["run-id"] === undefined ? {} : { runId: args["run-id"] }),
        out: write,
        err: writeErr,
        onRun: handle => {
          onInterrupt(handle.interrupt);
        },
      });
      if (!applied.ok) {
        writeErr(applied.error);
        process.exitCode = 1;
        return;
      }
      const [first, ...rest] = applied.lines;
      const mark =
        applied.outcome.kind === "kept"
          ? style("green", "✓")
          : style("yellow", "·");
      write(`${mark} ${first ?? ""}`);
      for (const line of rest) write(`  ${line}`);
      if (applied.outcome.kind === "unfinished") process.exitCode = 1;
    } finally {
      human?.close();
      store.close();
    }
  },
});

export const triage = defineCommand({
  meta: {
    name: "triage",
    description:
      "Merge new items about the same problem as others, asking about each",
  },
  args: {
    yes: {
      type: "boolean",
      description: "Make every merge without asking",
      default: false,
    },
  },
  run: ({ args }) =>
    withStore(async store => {
      if (!args.yes && !process.stdin.isTTY) {
        writeErr("Pass --yes to triage without a terminal.");
        process.exitCode = 1;
        return;
      }
      const done = await triageItems(store, async merge => {
        for (const line of formatMerge(merge)) write(line);
        return args.yes || (await confirm("Merge them? [y/N] "));
      });
      write(`${style("green", "✓")} ${triageSummary(done)}`);
    }),
});

export const split = defineCommand({
  meta: {
    name: "split",
    description: "Take apart the items triage merged into one",
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
      const moved = store.splitFeedback(found.item.id);
      write(
        moved === 0
          ? `Nothing was merged into ${found.item.id.slice(0, 12)}.`
          : `${style("green", "✓")} split ${String(moved)} item(s) back out of ${found.item.id.slice(0, 12)}`,
      );
    }),
});
