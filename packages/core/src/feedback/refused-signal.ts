/**
 * @file The `tool.refused` signal (specs/feedback/capture.md): a tool the
 *   driver's own guard refused repeatedly in one node is the agent's context
 *   gap, filed once per tool across nodes.
 */

import type { Signal } from "./end-signals.ts";

/** The refusals of one tool in one node that make a `tool.refused` record. */
export const REFUSED_AT = 3;

/**
 * The record for `tool`; the title names the tool and not the node so every
 * node shares one item, and the evidence is the tool's name only.
 */
export const refusedSignal = (tool: string): Signal => ({
  code: "tool.refused",
  kind: "context-gap",
  target: "workflow",
  severity: "low",
  title: `${tool} was refused repeatedly`,
  body: `The driver's guard refused \`${tool}\` ${String(REFUSED_AT)} times in one node. Add a rule for it to the node's \`tools.allow\`, or tell the node in its prompt not to use it.`,
  evidence: [tool],
});
