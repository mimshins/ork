/**
 * @file `delegate` and `spawn_worker`: a leader hands tasks to the nodes it
 *   owns, or to new instances of a child worker, and gets their reports back
 *   when all are done (ADR-017). Only leaders inside a run get them.
 */

import type { ChildReport, Delegation } from "@krapht/ork-core";
import { z } from "zod";

import { defineTool, text, type ToolText } from "./tool.ts";

const BRIEF = z
  .string()
  .min(1)
  .describe(
    "Self-contained: the goal, the files that matter, and what done looks like. The child does not see your conversation.",
  );

/** What the leader reads back: each report without the usage details. */
const reportLine = (report: ChildReport): Record<string, unknown> => {
  const { usage, ...output } = report.output;
  const cost =
    usage !== null && typeof usage === "object" && "costUsd" in usage
      ? usage.costUsd
      : undefined;
  return {
    child: report.child,
    ok: report.ok,
    ...output,
    ...(cost === undefined ? {} : { costUsd: cost }),
    // A refused task's reason is already its summary.
    ...(report.ok ||
    report.error === undefined ||
    report.error === output["summary"]
      ? {}
      : { error: report.error }),
  };
};

export const delegationText = (delegation: Delegation): ToolText =>
  text(
    JSON.stringify({
      reports: delegation.reports.map(reportLine),
      ...(delegation.notes.length > 0 ? { notes: delegation.notes } : {}),
    }),
  );

export const delegateTool = defineTool({
  name: "delegate",
  description:
    "Hand tasks to nodes you own. Tasks in one call run in parallel; the call returns every child's report when all are done. Ork merges a passing child's branch into yours.",
  shape: {
    tasks: z
      .array(
        z.object({
          child: z.string().describe("The id of a node you own."),
          brief: BRIEF,
        }),
      )
      .min(1),
  },
  available: ({ ports }) => (ports.ownership?.children.length ?? 0) > 0,
  run: async ({ ports }, args) => {
    if (ports.ownership === undefined) return text("You own no nodes.");
    return delegationText(await ports.ownership.delegate(args.tasks));
  },
});

export const spawnWorkerTool = defineTool({
  name: "spawn_worker",
  description:
    "Start new instances of a child worker for work that splits into independent parts. Each runs in its own worktree; the call returns their reports when all are done.",
  shape: {
    tasks: z
      .array(
        z.object({
          template: z.string().describe("The id of a child worker you own."),
          brief: BRIEF,
        }),
      )
      .min(1),
  },
  available: ({ ports }) =>
    ports.ownership !== undefined &&
    ports.ownership.templates.length > 0 &&
    ports.ownership.workersLeft() > 0,
  run: async ({ ports }, args) => {
    if (ports.ownership === undefined) return text("You own no workers.");
    return delegationText(await ports.ownership.spawn(args.tasks));
  },
});
