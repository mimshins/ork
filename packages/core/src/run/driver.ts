/**
 * @file Which Claude driver a session runs on, one rule for every caller (`ork
 *   run`, `--node`, `ork chat`, `ork resume`, called and detached runs):
 *   `--driver`, else the node's (or its agent's), else the workflow's
 *   `defaults.driver` (the project's included), else the one ready on this
 *   machine when the run started. No driver is written into a workflow for lack
 *   of one.
 */

import type { Driver, Node, Workflow } from "@krapht/ork-schema";

/** The node types that start a session of their own, and so need a driver. */
const SESSION_TYPES: ReadonlySet<Node["type"]> = new Set([
  "claude.leader",
  "claude.worker",
]);

/** The driver a workflow names for a node, if it names one. */
export const namedDriver = (
  node: Node,
  workflow: Workflow,
): Driver | undefined =>
  ("driver" in node ? node.driver : undefined) ?? workflow.defaults?.driver;

/** The session nodes that name no driver, which take the one ready here. */
export const namingNoDriver = (workflow: Workflow): string[] =>
  Object.entries(workflow.nodes)
    .filter(
      ([, node]) =>
        SESSION_TYPES.has(node.type) &&
        namedDriver(node, workflow) === undefined,
    )
    .map(([id]) => id);

/**
 * The driver a session runs on: `override` (`--driver`), else what the workflow
 * names, else `ready`, the driver the run found ready when it started (and
 * recorded, for a resume). `undefined` only when none applies, which a run
 * refuses before it starts.
 */
export const sessionDriver = (choice: {
  override?: Driver | undefined;
  named?: Driver | undefined;
  ready?: Driver | undefined;
}): Driver | undefined => choice.override ?? choice.named ?? choice.ready;
