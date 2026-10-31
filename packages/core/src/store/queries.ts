/**
 * @file The store's queries beside runs and events, in one place: decisions and
 *   commands, feedback, and registered projects.
 */

import type { DatabaseSync } from "node:sqlite";

import { decisionQueries } from "./decisions.ts";
import { feedbackQueries } from "./feedback.ts";
import { projectQueries } from "./projects.ts";

/** Every query set on `db`; `insertFeedback` is the store's own. */
export const storeQueries = (db: DatabaseSync) => ({
  ...decisionQueries(db),
  ...feedbackQueries(db),
  ...projectQueries(db),
});
