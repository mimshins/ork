/**
 * @file `ork validate`'s driver check: each session node against what its
 *   driver declares (core's `driver-needs.ts`), for `--driver` if given, else
 *   the driver a run would take, the one ready here (`ready-driver.ts`).
 */

import {
  type DriverNeeds,
  driverQueues,
  driverRefusals,
  namingNoDriver,
} from "@krapht/ork-core";
import {
  AGENT_DRIVERS,
  DRIVER_IDS,
  readyDriver,
} from "@krapht/ork-integrations";
import {
  type Diagnostic,
  type Driver,
  DriverSchema,
  type Locate,
  retiredDriverHint,
  type Workflow,
} from "@krapht/ork-schema";

import { checksHere, type DriverChecks } from "./ready-driver.ts";

export const driverDiagnostics = async (
  workflow: Workflow,
  options: {
    override?: Driver | undefined;
    checks?: DriverChecks | undefined;
    drivers?: readonly DriverNeeds[] | undefined;
    locate?: Locate | undefined;
  },
): Promise<Diagnostic[]> => {
  // A look at the machine's tools only when a node leaves the driver open: a
  // run takes the one ready here, which may not serve it or be proven.
  // shortcut: no cached readiness exists, so this runs the drivers' checks
  // each time; cache it if validate grows slow.
  const looks =
    options.override === undefined && namingNoDriver(workflow).length > 0;
  const ready = looks
    ? readyDriver(await (options.checks ?? checksHere)())
    : undefined;
  const drivers = options.drivers ?? AGENT_DRIVERS;
  const choice = {
    override: options.override,
    ready: ready?.ok === true ? ready.driver : undefined,
  };
  const at = (
    node: string,
    severity: Diagnostic["severity"],
    code: string,
    message: string,
  ) => {
    const path = ["nodes", node];
    const found: Diagnostic = { severity, code, message, path };
    const place = options.locate?.(path);
    if (place !== null && place !== undefined) {
      found.line = place.line;
      found.column = place.column;
    }
    return found;
  };
  return [
    ...driverRefusals(workflow, drivers, choice).map(({ node, message }) =>
      at(node, "error", "driver.unfit", message),
    ),
    // An owner's queue is a refusal above; siblings only wait.
    ...driverQueues(workflow, drivers, choice)
      .filter(found => found.owner === undefined)
      .flatMap(({ nodes, message }) =>
        nodes
          .slice(0, 1)
          .map(node => at(node, "warning", "driver.queues", message)),
      ),
  ];
};

/** The `--driver` value, or why it is not a driver. */
export const driverArg = (
  value?: string,
): { ok: true; driver?: Driver } | { ok: false; error: string } => {
  if (value === undefined) return { ok: true };
  const parsed = DriverSchema.safeParse(value);
  return parsed.success
    ? { ok: true, driver: parsed.data }
    : {
        ok: false,
        error: `--${retiredDriverHint(value) ?? `driver must be one of ${DRIVER_IDS.join(", ")}, got \`${value}\``}`,
      };
};
