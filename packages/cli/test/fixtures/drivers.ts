/**
 * @file Driver checks for tests: which Claude drivers are "ready", so a run of
 *   a workflow that names no driver picks one without running a real `claude`
 *   or reading the machine's environment.
 */

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
      (["sdk", "cli"] as const).map(id => check(id, ready.includes(id))),
    );

/** Only the SDK driver is ready: what the tests' runs took before. */
export const sdkReady = readyOnly("sdk");
