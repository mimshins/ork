/**
 * @file Driver checks for tests: which Claude drivers are "ready", so a run of
 *   a workflow that names no driver picks one without running a real `claude`
 *   or reading the machine's environment.
 */

import type { DriverNeeds } from "@krapht/ork-core";
import type { DriverCheck, DriverId } from "@krapht/ork-integrations";

import type { DriverChecks } from "../../src/index.ts";

const check = (id: DriverId, ready: boolean): DriverCheck => ({
  id,
  result: ready
    ? { name: `claude (${id} driver)`, status: "ok", detail: `${id} is ready` }
    : {
        name: `claude (${id} driver)`,
        status: "warn",
        detail: `${id} is not ready`,
        hint: `Get the ${id} driver ready.`,
      },
});

/** Checks under which only `ready` pass. */
export const readyOnly =
  (...ready: DriverId[]): DriverChecks =>
  () =>
    Promise.resolve(
      (["open-code", "claude-code"] as const).map(id => check(id, ready.includes(id))),
    );

/**
 * Only open-code is ready: not the preferred driver, so a test sees which one a
 * run took. The tests' runtimes are stand-ins, so no adapter is needed.
 */
export const openCodeReady = readyOnly("open-code");

/**
 * Descriptors for the tests' stand-in sessions: every driver proven and able,
 * so a test of the run does not meet the real `open-code`, which is unproven.
 * Refusals have their own tests, with descriptors that lack things.
 */
export const standInDrivers: readonly DriverNeeds[] = (
  ["claude-code", "open-code", "command-code"] as const
).map(id => ({
  id,
  proven: true,
  onePerCheckout: id === "command-code",
  capabilities: {
    questions: true,
    permissionPrompt: true,
    price: true,
    midTurnMessages: true,
    reportSchema: true,
    turnLimit: true,
    mcpServers: true,
  },
}));
