/**
 * @file The driver a Claude node's session starts on (core's `sessionDriver`),
 *   and, when its model names that driver (`command-code.deepseek/…`, RFC-015),
 *   the fit check on the value an item rendered: the run's own check before it
 *   started saw only the written model.
 */

import {
  type DriverNeeds,
  type ExecuteContext,
  type NodeResult,
  type PlanResult,
  sessionDriver,
  sessionRefusals,
} from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";

import { notStarted } from "./session-turns.ts";

/** What stops the node from running on `driver`, in one line, or nothing. */
const refusalOn = (
  context: ExecuteContext,
  driver: Driver,
  drivers: readonly DriverNeeds[],
): string | undefined => {
  const id = context.template ?? context.id;
  const node = context.workflow.nodes[id];
  const descriptor = drivers.find(d => d.id === driver);
  if (node === undefined || descriptor === undefined) return undefined;
  const refusals = sessionRefusals(id, node, context.workflow, descriptor);
  return refusals.length === 0
    ? undefined
    : refusals.map(r => r.message).join("; ");
};

/** The session's driver, or the node's result when none fits. */
export const sessionDriverOf = (
  context: ExecuteContext,
  plan: Extract<PlanResult, { ok: true }>,
  options: {
    driver?: Driver | undefined;
    readyDriver?: Driver | undefined;
    drivers?: readonly DriverNeeds[] | undefined;
  },
): Driver | NodeResult => {
  const driver = sessionDriver({
    pinned: plan.pinned,
    override: options.driver,
    named: plan.driver,
    ready: options.readyDriver,
  });
  if (driver === undefined) {
    return notStarted(
      "tool_missing",
      "no agent driver is ready; see `ork doctor`",
    );
  }
  const unfit =
    plan.pinned === undefined
      ? undefined
      : refusalOn(context, driver, options.drivers ?? AGENT_DRIVERS);
  return unfit === undefined ? driver : notStarted("invalid_node", unfit);
};
