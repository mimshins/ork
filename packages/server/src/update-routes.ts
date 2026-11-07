/**
 * @file The new-version routes (specs/cli/updates.md): what the server knows of
 *   versions, from the record; the upgrade's plan, asked of the registry now;
 *   running it, only as planned; and the restart onto the new install, which
 *   `ork ui` does for the server, since the server can't know how it was
 *   started.
 */

import type { ServerContext } from "./context.ts";
import { accepted, fail, type Handlers, ok } from "./router.ts";
import { askPlan, NO_UPGRADE, startUpgrade } from "./upgrade-plan.ts";

type UpdateRoutes = Pick<
  Handlers,
  "version" | "upgradePlan" | "upgrade" | "restart"
>;

/** How long the restart waits, so the answer reaches the page first. */
export const RESTART_DELAY_MS = 100;

const CANNOT_RESTART =
  "This server can't restart itself; stop it and run `ork ui`.";

const RESTART_BUSY =
  "An upgrade is running; restart `ork ui` once it has ended.";

export const updateRoutes = (
  context: ServerContext,
  port: () => number,
): UpdateRoutes => ({
  version: () => ok(context.updates.info()),

  upgradePlan: async () => {
    const plan = await askPlan(context);
    return plan === null ? fail(400, NO_UPGRADE) : ok(plan);
  },

  upgrade: ({ body }) => startUpgrade(context, body.planId),

  restart: () => {
    const { restart } = context;
    if (restart === undefined) return fail(400, CANNOT_RESTART);
    if (context.updates.job()?.view().state === "running") {
      return fail(409, RESTART_BUSY);
    }
    setTimeout(restart, RESTART_DELAY_MS);
    return accepted({ port: port(), pid: context.pid });
  },
});
