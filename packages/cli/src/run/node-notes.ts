/**
 * @file What a run of one node (`ork run --node`) leaves out, said before its
 *   session starts: the messages, steps and `forEach` it does not run. A node
 *   with `forEach` (RFC-013) runs once with no item when it has `items`, and is
 *   refused when it has `from`, as the node that reports its list is not run.
 */

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
