/**
 * @file What must hold before a run starts: the programs it runs are installed,
 *   the variables it reads are set, no limit across runs is spent, a Claude
 *   driver is ready for the nodes that name none, and it has a checkout to work
 *   in. Each stops a run before it spends anything.
 */

import type { ProjectPlace, ProjectRecord, RunLimits } from "@krapht/ork-core";
import {
  envProblems,
  missingProgramMessage,
  missingPrograms,
  onPath,
} from "@krapht/ork-nodes";
import type { Driver, Workflow } from "@krapht/ork-schema";

import { prepareCheckout } from "./checkout.ts";
import { limitsRefusal, runLimits } from "./limits.ts";
import { runReadyDriver } from "./ready-driver.ts";
import type { RunWorkflowOptions } from "./workflow.ts";

type Inputs = Parameters<typeof prepareCheckout>[2];
type Checkout = Extract<
  Awaited<ReturnType<typeof prepareCheckout>>,
  { ok: true }
>;

export type Ready =
  | { ok: false; lines: string[] }
  | (Checkout & {
      limits: () => RunLimits;
      /** The driver for the nodes that name none, when some do. */
      readyDriver?: Driver;
    });

export const preflight = async (
  options: RunWorkflowOptions,
  given: {
    workflow: Workflow;
    /** The workflow as it runs: agents and the project's rules filled in. */
    effective: Workflow;
    place: ProjectPlace;
    projects: readonly ProjectRecord[];
    inputs: Inputs;
  },
): Promise<Ready> => {
  const { workflow, place, projects } = given;
  const installed =
    options.installed ??
    (options.tools === undefined ? (p: string) => onPath(p) : () => true);
  const missing = missingPrograms(workflow, installed);
  if (missing.length > 0) {
    return { ok: false, lines: missingProgramMessage(missing) };
  }
  const unset = envProblems(
    workflow,
    place,
    projects,
    options.resume?.history,
    options.err,
  );
  if (unset.length > 0) return { ok: false, lines: unset };
  const limits = runLimits(options.store, place, options.home);
  const refused = limitsRefusal(limits, workflow, options.resume?.history);
  if (refused.length > 0) return { ok: false, lines: refused };
  const driver = await runReadyDriver(given.effective, {
    override: options.driver,
    recorded: options.resume?.settings.readyDriver,
    checks: options.driverChecks,
  });
  if (!driver.ok) return { ok: false, lines: driver.lines };
  if (driver.line !== undefined) options.err(driver.line);
  const checkout = await prepareCheckout(
    workflow,
    { ...options, cwd: place.root },
    given.inputs,
  );
  if (!checkout.ok) return { ok: false, lines: checkout.lines };
  return {
    ...checkout,
    limits: limits.now,
    ...(driver.driver === undefined ? {} : { readyDriver: driver.driver }),
  };
};
