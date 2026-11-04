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
  recordPlanLimit: (report: PlanReport, at: string) => void;
} => {
  const put = db.prepare(
    "INSERT OR REPLACE INTO plan_limits (name, status, resets_at, at) VALUES (?, ?, ?, ?)",
  );
  const all = db.prepare(
    "SELECT name, status, resets_at, at FROM plan_limits ORDER BY name",
  );
  const clear = db.prepare("DELETE FROM plan_limits");
  return {
    clearPlanLimits: () => {
      clear.run();
    },
    recordPlanLimit: ({ window, status, resetsAt }, at) => {
      put.run(window, status, resetsAt ?? null, at);
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
