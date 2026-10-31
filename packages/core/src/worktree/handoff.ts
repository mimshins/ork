/**
 * @file A node's worktree under the project's git rules (ADR-032): opening it
 *   (named by the rules, on a branch or detached, taking its owner's work),
 *   bringing it up to its owner's work on a later run, and handing a passing
 *   child's work to its owner: a `--no-ff` merge, or a patch applied
 *   uncommitted. Also what a session is told about its checkout, and the
 *   artifacts carried into a new worktree.
 */

import type { ResolvedGitRules } from "@krapht/ork-schema";

import type {
  Checkout,
  KeptWorktree,
  NodeOutput,
  RunEvent,
} from "../run/types.ts";
import { gitOk } from "./git.ts";
import {
  carryFiles,
  createWorktree,
  fastForward,
  mergeBranch,
  type MergeResult,
  type Worktree,
} from "./manager.ts";
import { type NameInputs, namesFor } from "./names.ts";
import { applyChanges, changesSince, snapshot, syncFrom } from "./patch.ts";

/** A worktree, and the tree its own work is measured from (for patches). */
export type Tracked = Worktree & { snapshot?: string };

export type WorktreeEvent = Extract<RunEvent, { type: "worktree" }>;

/** Where a child's work goes: its owner's branch, or its folder. */
export const nameOf = (worktree: Worktree): string =>
  worktree.branch ?? worktree.path;

const headTree = async (worktree: string): Promise<string> =>
  (await gitOk(worktree, ["rev-parse", "HEAD^{tree}"])).trim();

/** The event recording what Ork did to a worktree. */
export const worktreeEvent = (
  id: string,
  action: WorktreeEvent["action"],
  worktree: Tracked,
  detail?: string,
): WorktreeEvent => ({
  type: "worktree",
  id,
  action,
  path: worktree.path,
  ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
  ...((action === "created" || action === "synced") &&
  worktree.snapshot !== undefined
    ? { snapshot: worktree.snapshot }
    : {}),
  ...(detail === undefined ? {} : { detail }),
});

/**
 * Opens a node's worktree: named by the rules, from `head` or its owner's work.
 * Under `commit: never` it is detached and takes the owner's uncommitted
 * changes too.
 */
export const openWorktree = async (options: {
  rules: ResolvedGitRules;
  root: string;
  runId: string;
  id: string;
  inputs: NameInputs;
  head: string;
  /** The owner's worktree, when the node has one. */
  host?: Tracked;
  /** Branches this run created, which it may check out again. */
  known: ReadonlySet<string>;
}): Promise<{ worktree: Tracked; copied: string[] }> => {
  const { rules, root, host } = options;
  const never = rules.commit === "never";
  const names = await namesFor({
    rules,
    root,
    runId: options.runId,
    nodeId: options.id,
    inputs: options.inputs,
  });
  const base =
    host === undefined
      ? options.head
      : (host.branch ?? (await gitOk(host.path, ["rev-parse", "HEAD"])).trim());
  const created = await createWorktree({
    root,
    path: names.path,
    ...(names.branch === undefined ? {} : { branch: names.branch }),
    base,
    known: names.branch !== undefined && options.known.has(names.branch),
  });
  if (created.reused && host?.branch !== undefined) {
    await fastForward(created.path, host.branch);
  }
  let measuredFrom: string;
  if (never && host !== undefined) {
    measuredFrom = await syncFrom(created.path, host.path);
  } else if (never) {
    measuredFrom = await snapshot(created.path);
  } else {
    measuredFrom = await headTree(created.path);
  }
  return {
    worktree: {
      path: created.path,
      ...(created.branch === undefined ? {} : { branch: created.branch }),
      snapshot: measuredFrom,
    },
    copied: created.copied,
  };
};

/**
 * A later run (a loop, another delegation) starts from the owner's work. With
 * commits, the branch fast-forwards when it has nothing of its own; under
 * `commit: never`, a child whose work reached its owner takes the owner's
 * state. Returns whether it was synced that way.
 */
export const refreshWorktree = async (
  rules: ResolvedGitRules,
  worktree: Tracked,
  host: Tracked,
  handedOver: boolean,
): Promise<boolean> => {
  if (rules.commit !== "never") {
    if (host.branch !== undefined)
      await fastForward(worktree.path, host.branch);
    return false;
  }
  if (!handedOver) return false;
  worktree.snapshot = await syncFrom(worktree.path, host.path);
  return true;
};

/** Hands a passing child's work to its owner's worktree: merged or patched. */
export const handOver = async (
  rules: ResolvedGitRules,
  child: Tracked,
  owner: Tracked,
  message: string,
): Promise<MergeResult> => {
  if (rules.merge === "patch" || child.branch === undefined) {
    const since = child.snapshot ?? (await headTree(child.path));
    return applyChanges(owner.path, await changesSince(child.path, since));
  }
  return mergeBranch(owner.path, child.branch, message);
};

/** What a session is told about where it works, and the rules there. */
export const checkoutFor = (
  rules: ResolvedGitRules,
  worktree: Tracked,
  own: boolean,
  owner: string,
): Checkout => ({
  path: worktree.path,
  ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
  commit: rules.commit,
  merge: rules.merge,
  own,
  owner,
});

/** A worktree the run leaves, without its reason yet. */
export const keptOf = (
  id: string,
  worktree: Tracked,
): Omit<KeptWorktree, "reason"> => ({
  id,
  path: worktree.path,
  ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
});

const artifactPaths = (output: NodeOutput | undefined): string[] => {
  const artifacts = output?.["artifacts"];
  if (artifacts === null || typeof artifacts !== "object") return [];
  return Object.values(artifacts).filter(v => typeof v === "string");
};

/**
 * Copies the reported artifacts of nodes that worked elsewhere (e.g. a shared
 * `spec` in the project root) into a new worktree, where they would otherwise
 * be missing.
 */
export const carryArtifacts = (
  worktree: string,
  outputs: ReadonlyMap<string, NodeOutput>,
  placeOf: ReadonlyMap<string, string>,
): string[] => {
  const carried: string[] = [];
  for (const [other, output] of outputs) {
    const from = placeOf.get(other);
    if (from === undefined || from === worktree) continue;
    carried.push(...carryFiles(from, worktree, artifactPaths(output)));
  }
  return carried;
};

/** Runs work for one key at a time, e.g. one merge into an owner at a time. */
export const oneAtATime = () => {
  const locks = new Map<string, Promise<unknown>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).then(work);
    locks.set(
      key,
      next.catch(() => null),
    );
    return next;
  };
};
