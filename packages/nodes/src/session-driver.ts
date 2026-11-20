/**
 * @file The driver a Claude node's session starts on (core's `sessionDriver`),
 *   and, when its model names that driver (`command-code.deepseek/…`, RFC-015),
 *   the fit check on the value an item rendered: the run's own check before it
 *   started saw only the written model. A sub-agent whose rendered model names
 *   another driver than the session's is refused on every driver.
 */

import {
  type DriverNeeds,
  type ExecuteContext,
  type NodeResult,
  pinClashes,
  type PlanResult,
  sessionDriver,
  sessionRefusals,
} from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";

import { notStarted } from "./session-turns.ts";

/** What stops the node from running on `driver`, one message each. */
const refusalsOn = (
  id: string,
  context: ExecuteContext,
  driver: Driver,
  drivers: readonly DriverNeeds[],
): string[] => {
  const node = context.workflow.nodes[id];
  const descriptor = drivers.find(d => d.id === driver);
  if (node === undefined || descriptor === undefined) return [];
  return sessionRefusals(id, node, context.workflow, descriptor).map(
    r => r.message,
  );
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
  const id = context.template ?? context.id;
  const unfit =
    plan.pinned === undefined
      ? []
      : refusalsOn(id, context, driver, options.drivers ?? AGENT_DRIVERS);
  // Always: a sub-agent's rendered model may name another driver than the one
  // `--driver`, the workflow or the ready driver gave. A written one is in
  // `unfit` too, once.
  const refusals = [
    ...new Set([...unfit, ...pinClashes(id, driver, plan.subagentPins)]),
  ];
  return refusals.length === 0
    ? driver
    : notStarted("invalid_node", refusals.join("; "));
};
