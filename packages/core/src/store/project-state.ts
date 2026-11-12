/**
 * @file The store's queries for what a project keeps outside its runs: `ork
 *   watch`'s triggers, the workflow builder's drafts and the follow-ups.
 */

import type { DatabaseSync } from "node:sqlite";

import { draftQueries } from "./drafts.ts";
import { followUpQueries } from "./follow-ups.ts";
import { triggerQueries } from "./triggers.ts";

export const projectStateQueries = (db: DatabaseSync) => ({
  ...triggerQueries(db),
  ...draftQueries(db),
  ...followUpQueries(db),
});
