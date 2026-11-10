/**
 * @file Which agent driver is ready on this machine: each driver's own check
 *   (what `ork doctor` shows), and the one a run takes for the nodes that name
 *   no driver, so a committed workflow never carries one person's login.
 */

import { AGENT_DRIVERS, type DriverId } from "./drivers.ts";
import type { CheckResult, Env, Exec } from "./integration.ts";

export type DriverCheck = { id: DriverId; result: CheckResult };

/** Each registered agent driver's own check, in registry order. */
export const driverChecks = (run: Exec, env: Env): Promise<DriverCheck[]> =>
  Promise.all(
    AGENT_DRIVERS.map(async driver => ({
      id: driver.id,
      result: await driver.doctor(run, env),
    })),
  );

/**
 * The driver a run takes when more than one is ready: most people have a
 * `claude` login rather than an API key.
 */
export const PREFERRED_DRIVER: DriverId = "claude-code";

export type ReadyDriver =
  | {
      ok: true;
      driver: DriverId;
      /** Its check's detail, as `ork doctor` shows it. */
      detail: string;
      /** How many drivers are ready. */
      ready: number;
    }
  | {
      ok: false;
      /** What `ork doctor` says to do, one hint per driver. */
      hints: string[];
    };

/**
 * The driver ready here: the one whose check passes; with more than one,
 * {@link PREFERRED_DRIVER}; with none, each driver's hint.
 */
export const readyDriver = (checks: readonly DriverCheck[]): ReadyDriver => {
  const ready = checks.filter(({ result }) => result.status === "ok");
  const pick = ready.find(({ id }) => id === PREFERRED_DRIVER) ?? ready.at(0);
  if (pick === undefined) {
    return {
      ok: false,
      hints: checks.flatMap(({ result }) =>
        result.hint === undefined ? [] : [result.hint],
      ),
    };
  }
  return {
    ok: true,
    driver: pick.id,
    detail: pick.result.detail,
    ready: ready.length,
  };
};
