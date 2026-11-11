/**
 * @file What `ork worktrees` prints: each worktree or branch a run left, with
 *   its state read from git, the plan `ork worktrees clean` or `remove` would
 *   carry out, and what a forced remove would lose. The words are core's
 *   (worktree/words.ts), which the Worktrees panel says too; this only colors
 *   them.
 */

import {
  type CleanStep,
  type LostWork,
  labelOf,
  mergeStateOf,
  type OrkWorktree,
  planLine,
  stateParts,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { chip } from "../term/chips.ts";
import { cut } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";
import { paint } from "../term/theme.ts";

/** One line of state: its merge state, then what clean would care about. */
export const worktreeState = (
  item: OrkWorktree,
  term: Term = termOf(process.stdout),
): string => {
  const merge = mergeStateOf(item);
  const head =
    merge === "merged"
      ? [term.rich ? chip(term, "MERGED", "ok") : style("green", "merged")]
      : merge === "detached"
        ? ["detached"]
        : [];
  const parts = stateParts(item).map(part =>
    part.risk ? paint(term, "warn", part.text) : part.text,
  );
  return [...head, ...parts].join(" · ");
};

/** A name as the list shows it, saying when it's detached. */
const nameOf = (item: OrkWorktree): string =>
  mergeStateOf(item) === "detached"
    ? `${labelOf(item)} (detached)`
    : labelOf(item);

export const formatWorktrees = (
  items: readonly OrkWorktree[],
  term: Term = termOf(process.stdout),
): string[] => {
  if (items.length === 0) return ["No Ork worktrees or branches."];
  const width = Math.max(...items.map(i => nameOf(i).length));
  return items.flatMap(item => [
    `${style("bold", nameOf(item).padEnd(width))}  ${worktreeState(item, term)}`,
    // Rich, a long path is cut to the screen.
    ...(item.path === null
      ? []
      : [
          `  ${style("dim", term.rich ? cut(item.path, term.width - 2) : item.path)}`,
        ]),
  ]);
};

export const formatPlan = (steps: readonly CleanStep[]): string[] =>
  steps.map(step => {
    const { text, reason } = planLine(step);
    const why = reason === undefined ? "" : style("dim", ` (${reason})`);
    return `  ${text}${why}`;
  });

/** What a forced remove loses, as git prints it, under a heading each. */
export const formatLost = (lost: LostWork): string[] => [
  ...(lost.changes.length === 0
    ? []
    : ["Uncommitted changes:", ...lost.changes.map(line => `  ${line}`)]),
  ...(lost.commits.length === 0
    ? []
    : [
        lost.commitsOn === "no branch"
          ? "Commits on no branch:"
          : "Commits not merged:",
        ...lost.commits.map(line => `  ${line}`),
      ]),
];

/** What a forced clean loses, item by item: the same lines `remove` prints. */
export const formatLosses = (
  losses: readonly { item: OrkWorktree; lost: LostWork }[],
): string[] =>
  losses.flatMap(({ item, lost }) => {
    const lines = formatLost(lost);
    return lines.length === 0 ? [] : [`Loses in ${labelOf(item)}:`, ...lines];
  });
