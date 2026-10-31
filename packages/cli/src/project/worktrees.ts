/**
 * @file What `ork worktrees` prints: each worktree or branch a run left, with
 *   its state read from git, and the plan `ork worktrees clean` would carry
 *   out.
 */

import type { CleanStep, OrkWorktree } from "@krapht/ork-core";

import { style } from "../output.ts";

/** One line of state: where it is and what clean would care about. */
export const worktreeState = (item: OrkWorktree): string => {
  const parts: string[] = [];
  if (item.path === null) parts.push("no worktree");
  else if (item.missing) parts.push("missing (prunable)");
  if (item.dirty) parts.push(style("yellow", "uncommitted changes"));
  if (item.branch === undefined) {
    parts.push(
      item.ahead > 0
        ? style(
            "yellow",
            `detached, ${String(item.ahead)} commit(s) on no branch`,
          )
        : "detached, nothing committed",
    );
  } else {
    parts.push(
      item.merged
        ? style("green", "merged")
        : `${String(item.ahead)} commit(s) not merged`,
    );
  }
  if (item.inMainCheckout) parts.push("checked out here");
  return parts.join(" · ");
};

/** A worktree's name: its branch, or its run and node when detached. */
const labelOf = (item: OrkWorktree): string =>
  item.branch ?? `${item.runId}/${item.nodeId} (detached)`;

export const formatWorktrees = (items: readonly OrkWorktree[]): string[] => {
  if (items.length === 0) return ["No Ork worktrees or branches."];
  const width = Math.max(...items.map(i => labelOf(i).length));
  return items.flatMap(item => [
    `${style("bold", labelOf(item).padEnd(width))}  ${worktreeState(item)}`,
    ...(item.path === null ? [] : [`  ${style("dim", item.path)}`]),
  ]);
};

export const formatPlan = (steps: readonly CleanStep[]): string[] =>
  steps.map(step => {
    const actions = [
      ...(step.removeWorktree ? ["remove worktree"] : []),
      ...(step.deleteBranch ? ["delete branch"] : []),
    ];
    const what = actions.length > 0 ? actions.join(" + ") : "keep";
    const why = step.skip === undefined ? "" : style("dim", ` (${step.skip})`);
    return `  ${labelOf(step.item)}: ${what}${why}`;
  });
