/**
 * @file Where each node of a run works (ADR-020). A `worktree` node gets its
 *   own worktree beside the clone; `shared` and `readonly` nodes, and tool and
 *   gate nodes, work in their owner's worktree or the project root. After a
 *   node, Ork commits its leftovers and merges a passing child into its owner.
 */

import { isClaudeNode } from "@krapht/ork-schema";

import type { CompiledGraph } from "../graph/types.ts";
import type {
  Checkout,
  KeptWorktree,
  NodeOutput,
  NodeResult,
  RunEvent,
  Workspace,
} from "../run/types.ts";
import {
  carryFiles,
  commitLeftovers,
  createWorktree,
  mergeBranch,
  removeWorktree,
  type Worktree,
} from "./manager.ts";

export type WorkspaceOptions = {
  graph: CompiledGraph;
  runId: string;
  /** The project's git root and the commit root nodes branch from. */
  root: string;
  head: string;
  onEvent: (event: RunEvent) => void;
};

type Isolation = "worktree" | "shared" | "readonly";

const artifactPaths = (output: NodeOutput | undefined): string[] => {
  const artifacts = output?.["artifacts"];
  if (artifacts === null || typeof artifacts !== "object") return [];
  return Object.values(artifacts).filter(v => typeof v === "string");
};

export const createWorkspace = (options: WorkspaceOptions): Workspace => {
  const { graph, runId, root, head, onEvent } = options;
  const worktrees = new Map<string, Worktree>();
  const placeOf = new Map<string, string>();
  const outputs = new Map<string, NodeOutput>();
  const merged = new Set<string>();
  const unmerged = new Map<string, string>();
  const mergeLocks = new Map<string, Promise<unknown>>();

  const isolationOf = (id: string): Isolation => {
    const node = graph.nodes.get(id)?.node;
    if (node === undefined || !isClaudeNode(node)) return "shared";
    return node.isolation ?? graph.workflow.defaults?.isolation ?? "worktree";
  };
  const ownerOf = (id: string): string | undefined =>
    graph.nodes.get(id)?.node.parent;

  /** The nearest owner with a worktree, for nodes that work in someone else's. */
  const hostOf = (id: string): string | undefined => {
    let owner = ownerOf(id);
    while (owner !== undefined && !worktrees.has(owner)) owner = ownerOf(owner);
    return owner;
  };

  const event = (
    id: string,
    action: Extract<RunEvent, { type: "worktree" }>["action"],
    worktree: Worktree,
    detail?: string,
  ) => {
    const value: RunEvent = {
      type: "worktree",
      id,
      action,
      path: worktree.path,
      branch: worktree.branch,
    };
    if (detail !== undefined) value.detail = detail;
    onEvent(value);
  };

  const ensureWorktree = async (id: string): Promise<Worktree> => {
    const existing = worktrees.get(id);
    if (existing !== undefined) return existing;
    const host = hostOf(id);
    const base =
      host === undefined ? head : (worktrees.get(host)?.branch ?? head);
    const created = await createWorktree({ root, runId, nodeId: id, base });
    const worktree = { path: created.path, branch: created.branch };
    worktrees.set(id, worktree);
    // Artifacts of nodes that worked elsewhere (e.g. a shared `spec` in the
    // project root) would otherwise be missing on this branch.
    const carried: string[] = [];
    for (const [other, output] of outputs) {
      const from = placeOf.get(other);
      if (from === undefined || from === created.path) continue;
      carried.push(...carryFiles(from, created.path, artifactPaths(output)));
    }
    const notes = [
      ...(created.copied.length > 0
        ? [`copied ${created.copied.join(", ")}`]
        : []),
      ...(carried.length > 0 ? [`carried ${carried.join(", ")}`] : []),
    ];
    event(
      id,
      "created",
      created,
      notes.length > 0 ? notes.join("; ") : undefined,
    );
    return worktree;
  };

  const prepare: Workspace["prepare"] = async id => {
    if (isolationOf(id) === "worktree") {
      const worktree = await ensureWorktree(id);
      placeOf.set(id, worktree.path);
      return {
        cwd: worktree.path,
        checkout: { ...worktree, own: true, owner: id },
      };
    }
    const host = hostOf(id);
    const hosted = host === undefined ? undefined : worktrees.get(host);
    if (host === undefined || hosted === undefined) {
      placeOf.set(id, root);
      return { cwd: root };
    }
    placeOf.set(id, hosted.path);
    const checkout: Checkout = { ...hosted, own: false, owner: host };
    return { cwd: hosted.path, checkout };
  };

  /** One merge into an owner's worktree at a time. */
  const intoOwner = <T>(owner: string, work: () => Promise<T>): Promise<T> => {
    const previous = mergeLocks.get(owner) ?? Promise.resolve();
    const next = previous.then(work);
    mergeLocks.set(
      owner,
      next.catch(() => null),
    );
    return next;
  };

  const finish: Workspace["finish"] = async (id, result) => {
    const worktree =
      isolationOf(id) === "worktree" ? worktrees.get(id) : undefined;
    if (worktree === undefined) {
      outputs.set(id, result.output);
      return result;
    }
    let next: NodeResult = {
      ...result,
      output: { ...result.output, branch: worktree.branch },
    };
    try {
      if (await commitLeftovers(worktree.path, `ork: ${id} (run ${runId})`)) {
        event(id, "committed", worktree);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unmerged.set(id, `uncommitted: ${reason}`);
      next = {
        ...next,
        ok: false,
        error: `could not commit its work: ${reason}`,
      };
    }
    outputs.set(id, next.output);

    const owner = ownerOf(id);
    const ownerTree = owner === undefined ? undefined : worktrees.get(owner);
    if (next.ok && owner !== undefined && ownerTree !== undefined) {
      const outcome = await intoOwner(owner, () =>
        mergeBranch(
          ownerTree.path,
          worktree.branch,
          `ork: merge ${id} into ${owner} (run ${runId})`,
        ),
      );
      if (outcome.ok) {
        merged.add(id);
        unmerged.delete(id);
        event(id, "merged", worktree, `into ${ownerTree.branch}`);
      } else {
        const files = outcome.conflicts.join(", ");
        unmerged.set(id, `merge conflict${files === "" ? "" : ` in ${files}`}`);
        event(id, "conflict", worktree, files === "" ? outcome.error : files);
        next = {
          ...next,
          output: {
            ...next.output,
            merge: {
              ok: false,
              conflicts: outcome.conflicts,
              into: ownerTree.branch,
            },
          },
        };
      }
    }
    return next;
  };

  const close: Workspace["close"] = async () => {
    const kept: KeptWorktree[] = [];
    for (const [id, worktree] of worktrees) {
      if (merged.has(id) && !unmerged.has(id)) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
          await removeWorktree(root, worktree.path);
          event(id, "removed", worktree);
          continue;
        } catch {
          kept.push({ id, ...worktree, reason: "could not be removed" });
          continue;
        }
      }
      const reason =
        unmerged.get(id) ??
        (ownerOf(id) === undefined ? "the run's result" : "not merged");
      kept.push({ id, ...worktree, reason });
    }
    return kept;
  };

  return { prepare, finish, close };
};
