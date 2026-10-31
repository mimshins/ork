/**
 * @file Before a run with worktree nodes: the project must be a git repository
 *   with a commit, its instructions, skills and agents must be committed
 *   (worktrees get only committed files, unless `--allow-dirty`), and the
 *   project's `git.base` must name a commit, which root worktrees start from.
 */

import {
  gitRulesOf,
  inspectProject,
  type NameInputs,
  resolveBase,
} from "@krapht/ork-core";
import { isClaudeNode, type Workflow } from "@krapht/ork-schema";

import { style } from "../output.ts";

/** Why a run refuses to start with uncommitted agent files. */
export const dirtyAgentMessage = (files: readonly string[]): string[] => [
  "These instructions, skills or agents have uncommitted changes, and the worktrees only get committed files:",
  ...files.slice(0, 20).map(f => `  ${f}`),
  ...(files.length > 20 ? [`  … and ${String(files.length - 20)} more`] : []),
  "Commit or stash them, or pass --allow-dirty to run with the committed versions.",
];

/** Claude nodes that get their own worktree. */
export const worktreeNodes = (workflow: Workflow): string[] =>
  Object.entries(workflow.nodes)
    .filter(
      ([, node]) =>
        isClaudeNode(node) &&
        node.type !== "claude.subagent" &&
        (node.isolation ?? workflow.defaults?.isolation ?? "worktree") ===
          "worktree",
    )
    .map(([id]) => id);

export type PreparedCheckout =
  | {
      ok: true;
      /** The git root, when the run uses worktrees. */
      root?: string;
      /** The commit root worktrees start from (`git.base`). */
      base: string;
    }
  | { ok: false; lines: string[] };

/** Checks the project for a run's worktrees, and resolves `git.base`. */
export const prepareCheckout = async (
  workflow: Workflow,
  options: {
    cwd: string;
    inPlace: boolean;
    allowDirty?: boolean;
    err: (line: string) => void;
  },
  inputs: NameInputs,
): Promise<PreparedCheckout> => {
  const isolated = worktreeNodes(workflow);
  if (isolated.length === 0 || options.inPlace) return { ok: true, base: "" };
  const project = await inspectProject(options.cwd);
  if (project === null) {
    return {
      ok: false,
      lines: [
        `${isolated.join(", ")} need a git worktree, but ${options.cwd} is not in a git repository with a commit; pass --in-place to run them here`,
      ],
    };
  }
  if (project.dirtyAgentFiles.length > 0 && options.allowDirty !== true) {
    return { ok: false, lines: dirtyAgentMessage(project.dirtyAgentFiles) };
  }
  if (project.dirtyOther > 0) {
    options.err(
      `${style(["yellow", "bold"], "warning")} ${String(project.dirtyOther)} uncommitted change(s) in this checkout are not in the worktrees`,
    );
  }
  try {
    const base = await resolveBase(project.root, gitRulesOf(workflow), inputs);
    return { ok: true, root: project.root, base };
  } catch (error) {
    return {
      ok: false,
      lines: [error instanceof Error ? error.message : String(error)],
    };
  }
};
