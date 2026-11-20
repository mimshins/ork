/**
 * @file What Claude Code last said of each of a plan's limits (RFC-007), kept
 *   across runs: one run's refusal is every run's on this account.
 */

import type { DatabaseSync } from "node:sqlite";

import type { PlanLimit, PlanReport } from "../runtime/types.ts";
import { text } from "./rows.ts";
import type { UsageStore } from "./types.ts";

export const planLimitQueries = (
  db: DatabaseSync,
): Pick<UsageStore, "planLimits" | "clearPlanLimits"> & {
  /** Records `report`, seen at `at`, by Ork `version` (`''` when unknown). */
  recordPlanLimit: (report: PlanReport, at: string, version: string) => void;
  /**
   * Forgets the limits other Ork versions recorded, except `rejected` ones
   * (they hold until they reset): a warning an older Ork stored, perhaps by a
   * bug since fixed, is not shown by this one.
   */
  forgetOtherVersions: (version: string) => void;
} => {
  const forget = db.prepare(
    "DELETE FROM plan_limits WHERE status != 'rejected' AND ork_version != ?",
  );
  const put = db.prepare(
    "INSERT OR REPLACE INTO plan_limits (name, status, resets_at, at, ork_version) VALUES (?, ?, ?, ?, ?)",
  );
  const all = db.prepare(
    "SELECT name, status, resets_at, at FROM plan_limits ORDER BY name",
  );
  const clear = db.prepare("DELETE FROM plan_limits");
  return {
    clearPlanLimits: () => Number(clear.run().changes),
    forgetOtherVersions: version => {
      forget.run(version);
    },
    recordPlanLimit: ({ window, status, resetsAt }, at, version) => {
      put.run(window, status, resetsAt ?? null, at, version);
    },
    planLimits: () =>
      all.all().flatMap((r): PlanLimit[] => {
        const status = text(r, "status");
        const resetsAt = text(r, "resets_at");
        return status === "allowed" ||
          status === "allowed_warning" ||
          status === "rejected"
          ? [
              {
                window: text(r, "name"),
                status,
                at: text(r, "at"),
                ...(resetsAt === "" ? {} : { resetsAt }),
              },
            ]
          : [];
      }),
  };
};
