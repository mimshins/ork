/**
 * @file Where each node of a run works (ADR-020), under the project's git rules
 *   (ADR-032). A `worktree` node gets its own worktree beside the clone, named
 *   by the rules; `shared` and `readonly` nodes, and tool and gate nodes, work
 *   in their owner's worktree or the project root, and a `readonly` node with
 *   no owner in the worktree its input came from. A `continue` node works in
 *   that worktree too, and writes there (ADR-037). After a node, Ork commits
 *   its leftovers (unless `commit: never`) and brings a passing child's work to
 *   its owner: a merge, a patch, or not at all. A spawned worker works like the
 *   declared child it is an instance of.
 */

import { isClaudeNode } from "@krapht/ork-schema";

import type { CompiledGraph } from "../graph/types.ts";
import { gitRulesOf } from "../project/rules.ts";
import type {
  NodeOutput,
  NodeResult,
  RunEvent,
  Workspace,
} from "../run/types.ts";
import { closeWorktrees } from "./close.ts";
import { withConflict } from "./conflict.ts";
import {
  carryArtifacts,
  checkoutFor,
  commitWork,
  uncommitted,
  handOver,
  nameOf,
  openWorktree,
  oneAtATime,
  placed,
  reenter,
  type Tracked,
  worktreeEvent,
  type WorktreeEvent,
} from "./handoff.ts";
import type { NameInputs } from "./names.ts";
import { type AdoptedWorktree, seedResumed } from "./resumed.ts";
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
  adopt?: readonly AdoptedWorktree[];
  /** Where a resumed run's nodes last worked (their sessions' folders). */
  places?: ReadonlyMap<string, string>;
  /** Branches this run created before (a resumed run), which it may reuse. */
  known?: readonly string[];
};

type Isolation = "worktree" | "continue" | "shared" | "readonly";

const ITEM_FAILED = "item failed; kept for inspection";

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
  /** A `continue` node → the node whose worktree it works in this time. */
  const continued = new Map<string, string>();
  seedResumed(options.adopt ?? [], options.places ?? new Map(), {
    worktrees,
    placeOf,
    merged,
  });
  const nodeOf = (id: string) =>
    graph.nodes.get(templateOf.get(id) ?? id)?.node;
  const ownerOf = (id: string): string | undefined => nodeOf(id)?.parent;
  const isolationOf = (id: string): Isolation => {
    const node = nodeOf(id);
    if (node === undefined || !isClaudeNode(node)) return "shared";
    const isolation =
      node.isolation ?? graph.workflow.defaults?.isolation ?? "worktree";
    // `continue` from the defaults, on a node in the tree, is a worktree.
    const inTree =
      ownerOf(id) !== undefined ||
      (graph.nodes.get(templateOf.get(id) ?? id)?.children.length ?? 0) > 0;
    return isolation === "continue" && inTree ? "worktree" : isolation;
  };
  /** The node's own worktree, if it works in one. */
  const ownTree = (id: string): Tracked | undefined => {
    const isolation = isolationOf(id);
    const own =
      isolation === "worktree" ||
      (isolation === "continue" && !continued.has(id));
    return own ? worktrees.get(id) : undefined;
  };

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
    const again =
      existing === undefined
        ? "new"
        : await reenter(root, rules, existing, hosted, merged.has(id));
    if (again === "synced" && existing !== undefined && hosted !== undefined) {
      event(id, "synced", existing, `from ${nameOf(hosted)}`);
    }
    if (existing !== undefined && again !== "gone") return existing;
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

  /** The node whose worktree `id`'s input came from, if there is one. */
  const upstreamOf = (id: string): string | undefined => {
    const declared = templateOf.get(id) ?? id;
    const place = upstreamPlace(graph, declared, placeOf, root);
    return [...worktrees].find(([, w]) => w.path === place)?.[0];
  };

  const prepare: Workspace["prepare"] = async (id, template) => {
    if (template !== undefined) templateOf.set(id, template);
    const isolation = isolationOf(id);
    const from = isolation === "continue" ? upstreamOf(id) : undefined;
    const input = from === undefined ? undefined : worktrees.get(from);
    continued.delete(id);
    if (from !== undefined && from !== id && input !== undefined) {
      continued.set(id, from);
      placeOf.set(id, input.path);
      const checkout = checkoutFor(rules, input, false, from);
      return { cwd: input.path, checkout };
    }
    // With no one worktree upstream, a `continue` node gets its own.
    if (isolation === "worktree" || isolation === "continue") {
      const worktree = await ensureWorktree(id);
      placeOf.set(id, worktree.path);
      return {
        cwd: worktree.path,
        checkout: checkoutFor(rules, worktree, true, id),
      };
    }
    const host =
      hostOf(id) ?? (isolation === "readonly" ? upstreamOf(id) : undefined);
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
    const worktree = ownTree(id);
    // Under commit: never, children take the leader's uncommitted work.
    if (worktree === undefined || never) return null;
    const message = `ork: ${id} before delegating (run ${runId})`;
    const work = await commitWork(worktree, never, message);
    if (work.committed) event(id, "committed", worktree, "before delegating");
    return work.error ?? null;
  };

  /** Reports where the node worked, and commits what it left there. */
  const settle = async (
    id: string,
    holder: string,
    worktree: Tracked,
    result: NodeResult,
  ): Promise<NodeResult> => {
    // Whatever this run adds is unmerged until it is merged.
    merged.delete(holder);
    const next = placed(result, worktree);
    const work = await commitWork(worktree, never, `ork: ${id} (run ${runId})`);
    if (work.committed) event(id, "committed", worktree);
    if (work.error === undefined) return next;
    unmerged.set(holder, `uncommitted: ${work.error}`);
    return uncommitted(next, work.error);
  };

  const finish: Workspace["finish"] = async (id, result) => {
    const from = continued.get(id);
    const input = from === undefined ? undefined : worktrees.get(from);
    if (from !== undefined && input !== undefined) {
      const done = await settle(id, from, input, result);
      outputs.set(id, done.output);
      return done;
    }
    const worktree = ownTree(id);
    if (worktree === undefined) {
      outputs.set(id, result.output);
      return result;
    }
    const next = await settle(id, id, worktree, result);
    outputs.set(id, next.output);

    // A failed fanned item keeps its worktree for the user to look at; a later
    // round that passes takes that reason back.
    if (!next.ok && templateOf.has(id) && !unmerged.has(id)) {
      unmerged.set(id, ITEM_FAILED);
    }
    if (next.ok && unmerged.get(id) === ITEM_FAILED) unmerged.delete(id);

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
    return withConflict(next, outcome.conflicts, nameOf(ownerTree));
  };

  const close: Workspace["close"] = () =>
    closeWorktrees({
      root,
      never,
      worktrees,
      merged,
      unmerged,
      ownerOf,
      onRemoved: (id, worktree) => {
        event(id, "removed", worktree);
      },
    });

  return { prepare, checkpoint, finish, close };
};
