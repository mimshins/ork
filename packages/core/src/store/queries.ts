/**
 * @file The store's queries beside runs and events, in one place: decisions and
 *   commands, feedback, registered projects, usage, and what a project keeps
 *   outside its runs (triggers, workflow drafts, follow-ups).
 */

import type { DatabaseSync } from "node:sqlite";

import { decisionQueries } from "./decisions.ts";
import { feedbackQueries } from "./feedback.ts";
import { linkQueries } from "./links.ts";
import { planLimitQueries } from "./plan-limits.ts";
import { projectStateQueries } from "./project-state.ts";
import { projectQueries } from "./projects.ts";
import { toolCpuQueries } from "./tool-cpu.ts";
import { usageQueries } from "./usage.ts";

/**
 * Every query set on `db`; `insertFeedback`, `recordUsage` and `recordToolCpu`
 * are the store's own.
 */
export const storeQueries = (db: DatabaseSync) => ({
  ...decisionQueries(db),
  ...linkQueries(db),
  ...feedbackQueries(db),
  ...projectQueries(db),
  ...usageQueries(db),
  ...toolCpuQueries(db),
  ...planLimitQueries(db),
  ...projectStateQueries(db),
});
