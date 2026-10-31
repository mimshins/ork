/**
 * @file Where each node of a run works (ADR-020), under the project's git rules
 *   (ADR-032). A `worktree` node gets its own worktree beside the clone, named
 *   by the rules; `shared` and `readonly` nodes, and tool and gate nodes, work
 *   in their owner's worktree or the project root, and a `readonly` node with
 *   no owner in the worktree its input came from. After a node, Ork commits its
 *   leftovers (unless `commit: never`) and brings a passing child's work to its
 *   owner: a merge, a patch, or not at all. A spawned worker works like the
 *   declared child it is an instance of.
 */

import { existsSync } from "node:fs";

import { isClaudeNode } from "@krapht/ork-schema";

import type { CompiledGraph } from "../graph/types.ts";
import { gitRulesOf } from "../project/rules.ts";
import type {
  KeptWorktree,
  NodeOutput,
  NodeResult,
  RunEvent,
  Workspace,
} from "../run/types.ts";
import {
  carryArtifacts,
  checkoutFor,
  handOver,
  keptOf,
  nameOf,
  openWorktree,
  oneAtATime,
  refreshWorktree,
  type Tracked,
  worktreeEvent,
  type WorktreeEvent,
} from "./handoff.ts";
import { commitLeftovers, removeWorktree } from "./manager.ts";
import type { NameInputs } from "./names.ts";
import { upstreamPlace } from "./upstream.ts";

export type WorkspaceOptions = {
  graph: CompiledGraph;
  runId: string;
  /** The project's git root and the commit root nodes branch from. */
  root: string;
  head: string;
  /** The run's inputs, for `{inputs.<name>}` in the git rules' templates. */
  inputs?: NameInputs;
  onEvent: (event: RunEvent) => void;
  /** Worktrees a resumed run left whose folders are still there. */
  adopt?: readonly {
    id: string;
    path: string;
    branch?: string;
    snapshot?: string;
    merged: boolean;
  }[];
  /** Branches this run created before (a resumed run), which it may reuse. */
  known?: readonly string[];
};

type Isolation = "worktree" | "shared" | "readonly";

export const createWorkspace = (options: WorkspaceOptions): Workspace => {
  const { graph, runId, root, head, onEvent } = options;
  const rules = gitRulesOf(graph.workflow);
  const never = rules.commit === "never";
  const known = new Set(options.known ?? []);
  const worktrees = new Map<string, Tracked>();
  const placeOf = new Map<string, string>();
  const outputs = new Map<string, NodeOutput>();
  const merged = new Set<string>();
  const unmerged = new Map<string, string>();
  const intoOwner = oneAtATime();
  const templateOf = new Map<string, string>();
  for (const left of options.adopt ?? []) {
    if (!existsSync(left.path)) continue;
    const { id, merged: wasMerged, ...worktree } = left;
    worktrees.set(id, worktree);
    if (wasMerged) merged.add(id);
  }

  const nodeOf = (id: string) =>
    graph.nodes.get(templateOf.get(id) ?? id)?.node;
  const isolationOf = (id: string): Isolation => {
    const node = nodeOf(id);
    if (node === undefined || !isClaudeNode(node)) return "shared";
    return node.isolation ?? graph.workflow.defaults?.isolation ?? "worktree";
  };
  const ownerOf = (id: string): string | undefined => nodeOf(id)?.parent;

  /** The nearest owner with a worktree, for nodes that work in someone else's. */
  const hostOf = (id: string): string | undefined => {
    let owner = ownerOf(id);
    while (owner !== undefined && !worktrees.has(owner)) owner = ownerOf(owner);
    return owner;
  };

  const event = (
    id: string,
    action: WorktreeEvent["action"],
    worktree: Tracked,
    detail?: string,
  ) => {
    onEvent(worktreeEvent(id, action, worktree, detail));
  };

  const ensureWorktree = async (id: string): Promise<Tracked> => {
    const host = hostOf(id);
    const hosted = host === undefined ? undefined : worktrees.get(host);
    const existing = worktrees.get(id);
    if (existing !== undefined) {
      if (
        hosted !== undefined &&
        (await refreshWorktree(rules, existing, hosted, merged.has(id)))
      ) {
        event(id, "synced", existing, `from ${nameOf(hosted)}`);
      }
      return existing;
    }
    const { worktree, copied } = await openWorktree({
      rules,
      root,
      runId,
      id,
      inputs: options.inputs ?? {},
      head,
      ...(hosted === undefined ? {} : { host: hosted }),
      known,
    });
    worktrees.set(id, worktree);
    if (worktree.branch !== undefined) known.add(worktree.branch);
    const carried = carryArtifacts(worktree.path, outputs, placeOf);
    const notes = [
      ...(copied.length > 0 ? [`copied ${copied.join(", ")}`] : []),
      ...(carried.length > 0 ? [`carried ${carried.join(", ")}`] : []),
    ];
    event(
      id,
      "created",
      worktree,
      notes.length > 0 ? notes.join("; ") : undefined,
    );
    return worktree;
  };

  /** A readonly node with no owner reads the worktree its input came from. */
  const readFrom = (id: string): string | undefined => {
    if (isolationOf(id) !== "readonly") return undefined;
    const declared = templateOf.get(id) ?? id;
    const place = upstreamPlace(graph, declared, placeOf, root);
    return [...worktrees].find(([, w]) => w.path === place)?.[0];
  };

  const prepare: Workspace["prepare"] = async (id, template) => {
    if (template !== undefined) templateOf.set(id, template);
    if (isolationOf(id) === "worktree") {
      const worktree = await ensureWorktree(id);
      placeOf.set(id, worktree.path);
      return {
        cwd: worktree.path,
        checkout: checkoutFor(rules, worktree, true, id),
      };
    }
    const host = hostOf(id) ?? readFrom(id);
    const hosted = host === undefined ? undefined : worktrees.get(host);
    if (host === undefined || hosted === undefined) {
      placeOf.set(id, root);
      return { cwd: root };
    }
    placeOf.set(id, hosted.path);
    const checkout = checkoutFor(rules, hosted, false, host);
    return { cwd: hosted.path, checkout };
  };

  const checkpoint: Workspace["checkpoint"] = async id => {
    const worktree =
      isolationOf(id) === "worktree" ? worktrees.get(id) : undefined;
    // Under commit: never, children take the leader's uncommitted work.
    if (worktree === undefined || never) return null;
    try {
      const message = `ork: ${id} before delegating (run ${runId})`;
      if (await commitLeftovers(worktree.path, message)) {
        event(id, "committed", worktree, "before delegating");
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const finish: Workspace["finish"] = async (id, result) => {
    const worktree =
      isolationOf(id) === "worktree" ? worktrees.get(id) : undefined;
    if (worktree === undefined) {
      outputs.set(id, result.output);
      return result;
    }
    // Whatever this run adds is unmerged until it is merged.
    merged.delete(id);
    let next: NodeResult = {
      ...result,
      output: {
        ...result.output,
        ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
        worktree: worktree.path,
      },
    };
    try {
      if (
        !never &&
        (await commitLeftovers(worktree.path, `ork: ${id} (run ${runId})`))
      ) {
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
    if (!next.ok || owner === undefined || ownerTree === undefined) return next;
    if (rules.merge === "never") {
      unmerged.set(id, "kept for its owner (merge: never)");
      return next;
    }
    const outcome = await intoOwner(owner, () =>
      handOver(
        rules,
        worktree,
        ownerTree,
        `ork: merge ${id} into ${owner} (run ${runId})`,
      ),
    );
    if (outcome.ok) {
      merged.add(id);
      unmerged.delete(id);
      event(id, "merged", worktree, `into ${nameOf(ownerTree)}`);
      return next;
    }
    const files = outcome.conflicts.join(", ");
    unmerged.set(id, `merge conflict${files === "" ? "" : ` in ${files}`}`);
    event(id, "conflict", worktree, files === "" ? outcome.error : files);
    return {
      ...next,
      output: {
        ...next.output,
        merge: {
          ok: false,
          conflicts: outcome.conflicts,
          into: nameOf(ownerTree),
        },
      },
    };
  };

  const close: Workspace["close"] = async () => {
    const kept: KeptWorktree[] = [];
    for (const [id, worktree] of worktrees) {
      if (merged.has(id) && !unmerged.has(id)) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- git takes one lock at a time
          await removeWorktree(root, worktree.path, never);
          event(id, "removed", worktree);
          continue;
        } catch {
          kept.push({
            ...keptOf(id, worktree),
            reason: "could not be removed",
          });
          continue;
        }
      }
      const reason =
        unmerged.get(id) ??
        (ownerOf(id) === undefined
          ? never
            ? "the run's result, uncommitted"
            : "the run's result"
          : "not merged");
      kept.push({ ...keptOf(id, worktree), reason });
    }
    return kept;
  };

  return { prepare, checkpoint, finish, close };
};
