/**
 * @file What a run of one node (`ork run --node`) leaves out, said before its
 *   session starts: the messages, steps and `forEach` it does not run. A node
 *   with `forEach` (RFC-013) runs once with no item when it has `items`, and is
 *   refused when it has `from`, as the node that reports its list is not run.
 *   And, after it, its run summary: how the node ended
 *   (specs/runtime/session-ends.md).
 */

import {
  endOf,
  type NodeResult,
  type NodeSummary,
  type RunResult,
} from "@krapht/ork-core";
import { beforeOf, type Workflow } from "@krapht/ork-schema";

import { style } from "../output.ts";

/** A warning line, as the run prints it. */
export const noteLines = (lines: readonly string[]): string[] =>
  lines.map(line => `${style(["yellow", "bold"], "warning")} ${line}`);

/** Why a node can't run alone, or what a run of it leaves out. */
export const oneNodeNotes = (
  workflow: Workflow,
  id: string,
): { error?: string; warnings: string[] } => {
  const node = workflow.nodes[id];
  if (node === undefined) return { warnings: [] };
  const each = "forEach" in node ? node.forEach : undefined;
  if (each !== undefined && "from" in each) {
    return {
      error: `\`${id}\` runs once for each item of ${each.from}, a list another node reports, and a run of one node does not run that node; run the whole workflow, or give it \`items\` of its own`,
      warnings: [],
    };
  }
  const steps = [
    ...(beforeOf(node, workflow.defaults) === undefined ? [] : ["before"]),
    ...("verify" in node && node.verify !== undefined ? ["verify"] : []),
  ];
  return {
    warnings: [
      ...("notify" in node && node.notify
        ? [
            `${id}'s notify: does nothing here: a run of one node has no message bus.`,
          ]
        : []),
      ...(each === undefined
        ? []
        : [
            `${id}'s forEach: does not fan out in a run of one node: it runs once, with no item.`,
          ]),
      ...steps.map(
        step => `${id}'s ${step}: does not run in a run of one node.`,
      ),
    ],
  };
};

/** The `node.finished` fields that say how it ended: its error and its end. */
export const endedFields = (
  result: NodeResult,
): Pick<NodeSummary, "error" | "end"> => ({
  ...(result.error === undefined ? {} : { error: result.error }),
  end: endOf(result),
});

/** The one-node run's result, its reason the node's message. */
export const oneNodeResult = (
  runId: string,
  id: string,
  result: NodeResult,
  ok: boolean,
): RunResult => {
  const costUsd = result.usage?.costUsd ?? 0;
  return {
    runId,
    status: ok ? "succeeded" : "failed",
    costUsd,
    nodes: [
      {
        id,
        runs: 1,
        ok: result.ok,
        output: result.output,
        costUsd,
        ...endedFields(result),
      },
    ],
    reasons: result.error === undefined ? [] : [`${id}: ${result.error}`],
    worktrees: [],
    skipped: 0,
    failuresHandled: 0,
  };
};
