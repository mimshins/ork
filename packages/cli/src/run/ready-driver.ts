/**
 * @file The driver a run takes for the session nodes that name none (core's
 *   `driver.ts` has the whole rule): the one `ork doctor`'s own checks find
 *   ready on this machine, said in one line. With none ready, the run stops
 *   before any session starts, with the hints `ork doctor` gives. A resumed run
 *   keeps the driver it recorded. `--driver <id>` skips that look but checks
 *   that one driver's tool, and stops the run the same way when it isn't
 *   ready.
 */

import {
  type DriverNeeds,
  budgetWarnings,
  driverRefusals,
  namingNoDriver,
} from "@krapht/ork-core";
import {
  AGENT_DRIVERS,
  type DriverCheck,
  driverChecks,
  readyDriver,
} from "@krapht/ork-integrations";
import type { Driver, Workflow } from "@krapht/ork-schema";

import { exec } from "../doctor/checks.ts";

/**
 * The drivers' checks, or only `only`'s when given; tests pass their own, so no
 * real tool runs (a fake may ignore `only`: the caller picks its driver out).
 */
export type DriverChecks = (only?: Driver) => Promise<DriverCheck[]>;

/** The real checks: the tools on this machine and its environment. */
export const checksHere: DriverChecks = only =>
  only === undefined
    ? driverChecks(exec, process.env)
    : Promise.all(
        AGENT_DRIVERS.filter(({ id }) => id === only).map(async driver => ({
          id: driver.id,
          result: await driver.doctor(exec, process.env),
        })),
      );

/**
 * What stops a run on `--driver <id>`: its own doctor check isn't `ok`, so its
 * tool isn't found or isn't signed in. Empty when it is ready. Drivers named on
 * nodes aren't looked at here; they can sit on a branch that never runs.
 */
export const overrideRefusal = async (
  id: Driver,
  checks: DriverChecks | undefined,
): Promise<string[]> => {
  const found = (await (checks ?? checksHere)(id)).find(c => c.id === id);
  if (found === undefined || found.result.status === "ok") return [];
  const { detail, hint } = found.result;
  return [
    `--driver ${id}: ${id} isn't ready here (${detail}).`,
    ...(hint === undefined ? [] : [hint]),
    "See `ork doctor`.",
  ];
};

export type ReadyChoice =
  | {
      ok: true;
      /** For the nodes that name none; absent when every node names one. */
      driver?: Driver;
      /** What to say, when the run had to look. */
      line?: string;
    }
  | { ok: false; lines: string[] };

const subject = (names: readonly string[], all: boolean): string => {
  if (all) return "No driver is named, so the run uses";
  const [only] = names;
  return names.length === 1 && only !== undefined
    ? `${only} names no driver, so it uses`
    : `${names.join(", ")} name no driver, so they use`;
};

/**
 * The driver for `names`, the session nodes that name none, from `checks`.
 * `all` says whether they are every session node of the run.
 */
export const chooseReadyDriver = (
  names: readonly string[],
  all: boolean,
  checks: readonly DriverCheck[],
): ReadyChoice => {
  const ready = readyDriver(checks);
  if (!ready.ok) {
    return {
      ok: false,
      lines: [
        `No agent driver is ready here, and ${names.join(", ")} ${names.length === 1 ? "names" : "name"} none.`,
        ...ready.hints,
        "See `ork doctor`.",
      ],
    };
  }
  const why =
    ready.ready === 1
      ? `the one ready here (${ready.detail})`
      : `more than one is ready, and a run takes ${ready.driver} first`;
  return {
    ok: true,
    driver: ready.driver,
    line: `${subject(names, all)} the ${ready.driver} driver: ${why}.`,
  };
};

/**
 * What a run takes for its session nodes that name no driver: nothing when
 * `--driver` overrides them all or each names one; the driver a resumed run
 * recorded; otherwise the one ready here.
 */
export const runReadyDriver = async (
  workflow: Workflow,
  options: {
    override?: Driver | undefined;
    recorded?: Driver | undefined;
    checks?: DriverChecks | undefined;
  },
): Promise<ReadyChoice> => {
  if (options.override !== undefined) {
    const lines = await overrideRefusal(options.override, options.checks);
    return lines.length === 0 ? { ok: true } : { ok: false, lines };
  }
  const names = namingNoDriver(workflow);
  if (names.length === 0) return { ok: true };
  if (options.recorded !== undefined) {
    return { ok: true, driver: options.recorded };
  }
  const sessions = Object.values(workflow.nodes).filter(
    node => node.type === "agent.leader" || node.type === "agent.worker",
  ).length;
  return chooseReadyDriver(
    names,
    names.length === sessions,
    await (options.checks ?? checksHere)(),
  );
};

/**
 * What stops a session node from running on its driver, one line each: the
 * driver's declared `capabilities` and `proven` against what the node asks
 * (`drivers` default: the real descriptors; tests pass their own).
 */
export const unfitLines = (
  workflow: Workflow,
  drivers: readonly DriverNeeds[] | undefined,
  choice: {
    override?: Driver | undefined;
    ready?: Driver | undefined;
    only?: string;
  },
): string[] =>
  driverRefusals(workflow, drivers ?? AGENT_DRIVERS, choice).map(
    ({ message }) => message,
  );

/**
 * What a dollar budget can't see on a session node's driver, one line each
 * (RFC-015): warnings, never a reason to refuse. Same arguments as
 * `unfitLines`.
 */
export const budgetWarningLines = (
  workflow: Workflow,
  drivers: readonly DriverNeeds[] | undefined,
  choice: {
    override?: Driver | undefined;
    ready?: Driver | undefined;
    only?: string;
  },
): string[] =>
  budgetWarnings(workflow, drivers ?? AGENT_DRIVERS, choice).map(
    ({ message }) => message,
  );
