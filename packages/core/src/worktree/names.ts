/**
 * @file The names Ork gives a node's worktree and branch, from the project's
 *   git rules (`ork/{run}/{node}` and `../{clone}-worktrees/ork-{run}-{node}`
 *   by default). A worktree always lands beside the clone, never inside it
 *   (Claude Code would load the clone's instructions too) or anywhere else; a
 *   branch name must be one git accepts.
 */

import path from "node:path";

import type { ResolvedGitRules } from "@krapht/ork-schema";

import { inside } from "../context/files.ts";
import { renderGitTemplate } from "../project/templates.ts";
import { git } from "./git.ts";

export type NodeNames = {
  path: string;
  /** `undefined` under `commit: never`: the worktree is detached. */
  branch?: string;
};

export type NameInputs = Readonly<
  Record<string, string | number | boolean | undefined>
>;

/** The worktree path and branch for one node of a run, checked. */
export const namesFor = async (options: {
  rules: ResolvedGitRules;
  root: string;
  runId: string;
  nodeId: string;
  inputs: NameInputs;
}): Promise<NodeNames> => {
  const { rules, root } = options;
  const values = {
    run: options.runId,
    node: options.nodeId,
    clone: path.basename(root),
    inputs: options.inputs,
  };
  const target = path.resolve(root, renderGitTemplate(rules.worktrees, values));
  if (!inside(path.dirname(root), target) || inside(root, target)) {
    throw new Error(
      `git.worktrees puts ${options.nodeId}'s worktree at ${target}, which is not beside the clone (inside ${path.dirname(root)}, outside ${root})`,
    );
  }
  if (rules.commit === "never") return { path: target };
  const branch = renderGitTemplate(rules.branch, values);
  // A name starting with `-` would reach git as an option.
  const valid = branch.startsWith("-")
    ? { code: 1 }
    : await git(root, ["check-ref-format", "--branch", branch]);
  if (valid.code !== 0 || branch === "") {
    throw new Error(
      `git.branch gives ${options.nodeId} the branch "${branch}", which is not a valid branch name`,
    );
  }
  return { path: target, branch };
};

/** The commit worktrees without an owner start from (`git.base`). */
export const resolveBase = async (
  root: string,
  rules: ResolvedGitRules,
  inputs: NameInputs,
): Promise<string> => {
  const ref = renderGitTemplate(rules.base, {
    run: "",
    node: "",
    clone: path.basename(root),
    inputs,
  });
  const resolved = ref.startsWith("-")
    ? { code: 1, stdout: "" }
    : await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (resolved.code !== 0) {
    throw new Error(
      `git.base is ${ref}, which is not a commit here (Ork never fetches; fetch it yourself first)`,
    );
  }
  return resolved.stdout.trim();
};
