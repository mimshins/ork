/**
 * @file The store's queries beside runs and events, in one place: decisions and
 *   commands, feedback, registered projects, usage and workflow drafts.
 */

import type { DatabaseSync } from "node:sqlite";

import { decisionQueries } from "./decisions.ts";
import { draftQueries } from "./drafts.ts";
import { feedbackQueries } from "./feedback.ts";
import { linkQueries } from "./links.ts";
import { planLimitQueries } from "./plan-limits.ts";
import { projectQueries } from "./projects.ts";
import { triggerQueries } from "./triggers.ts";
import { usageQueries } from "./usage.ts";

/**
 * Every query set on `db`; `insertFeedback` and `recordUsage` are the store's
 * own.
 */
export const storeQueries = (db: DatabaseSync) => ({
  ...decisionQueries(db),
  ...linkQueries(db),
  ...feedbackQueries(db),
  ...projectQueries(db),
  ...usageQueries(db),
  ...planLimitQueries(db),
  ...triggerQueries(db),
  ...draftQueries(db),
});
