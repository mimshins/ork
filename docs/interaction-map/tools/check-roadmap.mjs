/**
 * @file Checks the roadmap (`public/js/data/roadmap.js`): unique ids, a shipped
 *   item's commits and date, an unshipped item's lack of them, and every doc
 *   link. Lists the commits on `main` that no item names, to review. Run by
 *   `pnpm map:check`.
 */

import { MILESTONES, OFF_ROADMAP } from "../public/js/data/roadmap.js";
import { git, linkProblem } from "./repo.mjs";

const PROGRESS = new Set(["done", "active", "next", "planned", "waiting"]);

/** @returns {{ errors: string[]; review: string[]; summary: string }} */
export const checkRoadmap = () => {
  /** @type {string[]} */
  const errors = [];
  const ids = new Set();
  /** @type {Set<string>} */
  const named = new Set(OFF_ROADMAP);

  for (const milestone of MILESTONES) {
    if (ids.has(milestone.id)) errors.push(`duplicate id ${milestone.id}`);
    ids.add(milestone.id);
    if (milestone.items.length === 0) {
      errors.push(`${milestone.id}: has no items`);
    }
    for (const item of milestone.items) {
      const at = `${milestone.id}/${item.id}`;
      if (ids.has(item.id)) errors.push(`duplicate id ${item.id}`);
      ids.add(item.id);
      if (!PROGRESS.has(item.status)) {
        errors.push(`${at}: unknown status ${item.status}`);
      }
      const commits = item.commits ?? [];
      if (item.status === "done") {
        if (commits.length === 0)
          errors.push(`${at}: done, but names no commit`);
        if (item.date === undefined)
          errors.push(`${at}: done, but has no date`);
      } else if (item.date !== undefined) {
        errors.push(`${at}: ${item.status}, but has a ship date`);
      }
      /** @type {string[]} */
      const dates = [];
      for (const hash of commits) {
        named.add(hash);
        const full = git([
          "rev-parse",
          "--verify",
          "--quiet",
          `${hash}^{commit}`,
        ]);
        if (full === "") {
          errors.push(`${at}: commit ${hash} does not exist`);
          continue;
        }
        if (
          // An ancestor of HEAD is its own merge base with HEAD.
          git(["merge-base", full, "HEAD"]) !== full
        ) {
          errors.push(`${at}: commit ${hash} is not on this branch`);
        }
        dates.push(git(["log", "-1", "--format=%ad", "--date=short", full]));
      }
      const newest = dates.toSorted().at(-1);
      if (
        item.date !== undefined &&
        newest !== undefined &&
        item.date !== newest
      ) {
        errors.push(
          `${at}: date ${item.date}, but its newest commit is from ${newest}`,
        );
      }
      for (const doc of item.docs ?? []) {
        const problem = linkProblem(doc);
        if (problem !== null) errors.push(`${at}: ${problem}`);
      }
    }
  }

  const review = git(["log", "--no-merges", "--format=%h %s", "HEAD"])
    .split("\n")
    .filter(line => line !== "" && !named.has(line.split(" ")[0] ?? ""));
  const items = MILESTONES.flatMap(m => m.items);
  const done = items.filter(i => i.status === "done").length;
  return {
    errors: errors.map(e => `roadmap: ${e}`),
    review,
    summary: `roadmap: ${String(MILESTONES.length)} milestones, ${String(done)} of ${String(items.length)} items done`,
  };
};
