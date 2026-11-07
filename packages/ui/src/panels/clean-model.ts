/**
 * @file What Clean merged… says, as pure functions: its title and description,
 *   each project's one-sentence summary of its plan (what goes, what's kept and
 *   why), the action's words counting what it does, and the result's heading.
 *   The plan's lines are core's, as `ork worktrees clean` prints them.
 */

import type {
  CleanPlanProject,
  CleanPlanStep,
} from "@krapht/ork-server/client";

import { counted } from "./worktrees-model.ts";

/** The projects a clean plan acts in or keeps something of. */
export const planned = (
  projects: readonly CleanPlanProject[],
): CleanPlanProject[] => projects.filter(p => p.steps.length > 0);

/** What a plan does: worktrees removed (or pruned) and branches deleted. */
export const totals = (steps: readonly CleanPlanStep[]) => ({
  worktrees: steps.filter(s => s.removeWorktree || s.prunes).length,
  branches: steps.filter(s => s.deleteBranch).length,
});

const acts = (step: CleanPlanStep): boolean =>
  step.removeWorktree || step.deleteBranch || step.prunes;

/** Why a step keeps its item: its reason, or a merged branch left as it is. */
const keptWhy = (step: CleanPlanStep): string =>
  step.skip ?? "no worktree, branch kept";

export const cleanTitle = (projects: readonly { name: string }[]): string => {
  const [only] = projects;
  return projects.length === 1 && only !== undefined
    ? `Clean merged worktrees in ${only.name}`
    : `Clean merged worktrees in ${counted(projects.length, "project")}`;
};

export const cleanDescription = (one: boolean): string =>
  `What \`ork worktrees clean\` does: removes the worktrees of branches merged into ${one ? "the project's current branch" : "each project's current branch"}. One with uncommitted changes, or checked out in the main checkout, is kept. Nothing is forced.`;

/** `Removes 2 worktrees. Keeps 2: uncommitted changes (1); …` */
export const cleanSummary = (steps: readonly CleanPlanStep[]): string => {
  const { worktrees, branches } = totals(steps);
  const doing = [
    ...(worktrees > 0 ? [`removes ${counted(worktrees, "worktree")}`] : []),
    ...(branches > 0 ? [`deletes ${counted(branches, "branch")}`] : []),
  ].join(" and ");
  const kept = steps.filter(step => !acts(step) || step.skip !== undefined);
  const reasons = new Map<string, number>();
  for (const step of kept) {
    reasons.set(keptWhy(step), (reasons.get(keptWhy(step)) ?? 0) + 1);
  }
  const keeping =
    kept.length === 0
      ? ""
      : `Keeps ${String(kept.length)}: ${[...reasons]
          .map(([why, count]) => `${why} (${String(count)})`)
          .join("; ")}.`;
  const first =
    doing === ""
      ? "Nothing to clean."
      : `${doing.charAt(0).toUpperCase()}${doing.slice(1)}.`;
  return [first, keeping].filter(part => part !== "").join(" ");
};

/**
 * `Remove 2 worktrees`, `Remove 2 worktrees and 3 branches`, `Delete 3
 * branches`.
 */
export const cleanAction = (
  projects: readonly CleanPlanProject[],
): string | null => {
  const { worktrees, branches } = totals(projects.flatMap(p => p.steps));
  if (worktrees === 0 && branches === 0) return null;
  if (worktrees === 0) return `Delete ${counted(branches, "branch")}`;
  return branches === 0
    ? `Remove ${counted(worktrees, "worktree")}`
    : `Remove ${counted(worktrees, "worktree")} and ${counted(branches, "branch")}`;
};

/** The result's heading: whether every project's part went. */
export const cleanedHeading = (
  results: readonly { error?: string }[],
): string =>
  results.some(result => result.error !== undefined)
    ? "Cleaned in part"
    : "Cleaned";
