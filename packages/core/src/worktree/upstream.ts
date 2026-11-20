/**
 * @file Where a `readonly` node with no owner works: in the checkout its input
 *   came from, so a reviewer after a leader sees the leader's branch. The
 *   node's incoming edges are followed back through control nodes (joins,
 *   splits, routers) and human gates, which work nowhere, to the nodes that
 *   ran; when they all worked in one worktree, that is the place, and otherwise
 *   the project root, or under `git.readonly: base` the run's read-only
 *   worktree at the base. A node with `forEach` worked where its items did. A
 *   tool node works like `shared`, but one whose `cwd` is inside one of the
 *   run's worktrees counts as working there (`build -> stat -> review`); a
 *   resumed run recovers that from the tool node's declared `cwd` and the
 *   replayed outputs, so it needs nothing the run's events did not already
 *   record.
 */

import path from "node:path";

import type { Node, ResolvedGitRules } from "@krapht/ork-schema";

import { parseTemplate, renderTemplate, type Scope } from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import { runScope } from "../run/scope.ts";
import type {
  Inputs,
  KeptWorktree,
  NodeOutput,
  RunEvent,
} from "../run/types.ts";
import { keptOf, type Tracked, worktreeEvent } from "./handoff.ts";
import type { NameInputs } from "./names.ts";
import {
  leftReadonlyBase,
  openReadonlyBase,
  READONLY_ID,
  removeReadonlyBase,
} from "./readonly-base.ts";

/** Where `id` worked: its own place, or for a fanned node each item's. */
const placesOf = (
  id: string,
  placeOf: ReadonlyMap<string, string>,
): string[] => {
  const own = placeOf.get(id);
  if (own !== undefined) return [own];
  const item = `${id}.`;
  return [...placeOf]
    .filter(([other]) => other.startsWith(item))
    .map(([, place]) => place);
};

/**
 * The one place `id`'s upstream nodes worked in other than `root`, or
 * `undefined` when there is none or they disagree. `placeOf` is where each node
 * that ran worked.
 */
export const upstreamPlace = (
  graph: CompiledGraph,
  id: string,
  placeOf: ReadonlyMap<string, string>,
  root: string,
): string | undefined => {
  const places = new Set<string>();
  const seen = new Set<string>([id]);
  const queue = [...(graph.nodes.get(id)?.incoming ?? [])].map(e => e.from);
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    if (seen.has(from)) continue;
    seen.add(from);
    const node = graph.nodes.get(from);
    const type = node?.node.type ?? "";
    if (type.startsWith("control.") || type === "human.gate") {
      queue.push(...(node?.incoming ?? []).map(e => e.from));
      continue;
    }
    for (const place of placesOf(from, placeOf)) {
      if (place !== root) places.add(place);
    }
  }
  const [only, other] = places;
  return other === undefined ? only : undefined;
};

/**
 * Where a run's readonly nodes with no owner and no input's worktree read under
 * `git.readonly: base` (`on`), unless `root` is already a run root: one
 * worktree at `head`, opened on first use (or a crash's leftover, adopted),
 * never anyone's input, and removed at the end however the run ended.
 */
export const readonlyBase = (run: {
  rules: ResolvedGitRules;
  root: string;
  runId: string;
  head: string;
  inputs?: NameInputs;
  adopt?: readonly { id: string; path: string }[];
  runRoot?: boolean;
  onEvent: (event: RunEvent) => void;
}) => {
  const event = (action: "created" | "removed", read: Tracked) => {
    run.onEvent(worktreeEvent(READONLY_ID, action, read));
  };
  const left = leftReadonlyBase(run.adopt ?? []);
  let tree = left === undefined ? undefined : Promise.resolve(left);
  /** It, once open; nothing when it never was or could not be. */
  const opened = (): Promise<Tracked | null> =>
    tree?.catch(() => null) ?? Promise.resolve(null);
  return {
    on: run.rules.readonly === "base" && run.runRoot !== true,
    /** Its folder, opened once for every node. */
    open: async (): Promise<string> => {
      tree ??= openReadonlyBase({ ...run, inputs: run.inputs ?? {} }).then(
        opening => {
          event("created", opening);
          return opening;
        },
        (error: unknown) => {
          tree = undefined;
          throw error;
        },
      );
      return (await tree).path;
    },
    /** `placeOf` without the nodes that read it: they are no one's input. */
    inputPlaces: async (
      placeOf: ReadonlyMap<string, string>,
    ): Promise<ReadonlyMap<string, string>> => {
      const read = await opened();
      return read === null
        ? placeOf
        : new Map([...placeOf].filter(([, place]) => place !== read.path));
    },
    /** Removes it; it is kept, and said so, only when that fails. */
    close: async (): Promise<KeptWorktree[]> => {
      const read = await opened();
      tree = undefined;
      if (read === null) return [];
      if (await removeReadonlyBase(run.root, read)) {
        event("removed", read);
        return [];
      }
      return [{ ...keptOf(READONLY_ID, read), reason: "could not be removed" }];
    },
  };
};

/**
 * A tool node's `cwd`, rendered and made absolute from `base`; none without
 * one.
 */
export const toolCwdOf = (
  node: Node | undefined,
  scope: Scope,
  base: string,
): string | undefined => {
  if (node === undefined || !node.type.startsWith("tool.")) return undefined;
  if (!("cwd" in node) || node.cwd === undefined) return undefined;
  const template = parseTemplate(node.cwd);
  if (!template.ok) return undefined;
  try {
    const rendered = renderTemplate(template.parts, scope);
    return rendered === "" ? undefined : path.resolve(base, rendered);
  } catch {
    // An output it names is missing: the node did not run there.
    return undefined;
  }
};

/**
 * A tool node that ran in `cwd`: when one of `paths` (the run's worktrees)
 * holds it, `id` counts as working there.
 */
export const placeTool = (
  id: string,
  cwd: string,
  paths: readonly string[],
  placeOf: Map<string, string>,
): void => {
  const held = paths.find(
    place => cwd === place || cwd.startsWith(`${place}${path.sep}`),
  );
  if (held !== undefined) placeOf.set(id, held);
};

const definedInputs = (inputs: NameInputs | undefined): Inputs =>
  Object.fromEntries(
    Object.entries(inputs ?? {}).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    ),
  );

/**
 * For a resumed run: where each replayed tool node with a `cwd` worked, when
 * that is one of `worktrees` (the adopted ones), set in `placeOf`.
 */
export const seedToolPlaces = (
  graph: CompiledGraph,
  run: {
    replayed?: ReadonlyMap<string, NodeOutput>;
    inputs?: NameInputs;
    root: string;
  },
  paths: readonly string[],
  placeOf: Map<string, string>,
): void => {
  const replayed = run.replayed ?? new Map<string, NodeOutput>();
  const scope = runScope(
    definedInputs(run.inputs),
    Object.fromEntries(replayed),
  );
  for (const id of replayed.keys()) {
    const cwd = toolCwdOf(graph.nodes.get(id)?.node, scope, run.root);
    if (cwd !== undefined) placeTool(id, cwd, paths, placeOf);
  }
};
