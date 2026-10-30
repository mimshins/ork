/**
 * @file The run's claims (`specs/messaging.md#claims`): before a node changes a
 *   file, a folder or another shared resource, it claims it, so nodes running
 *   at the same time do not change the same thing. A path claim covers
 *   everything under it. A refused node is told who holds what, and gets a
 *   notice when it is released; a node's claims are released when it finishes.
 *   Claims are advisory: they steer agents, they do not lock files.
 */

import path from "node:path";

import type { CompiledGraph } from "../graph/types.ts";
import type { Claims } from "../runtime/types.ts";
import type { RunEvent } from "./types.ts";

export type ClaimRegistry = {
  /** A node's claims; `template` is the declared node of a spawned worker. */
  port: (id: string, template: string | undefined, cwd: string) => Claims;
  /** Releases everything `id` holds: it finished. */
  releaseAll: (id: string) => void;
};

const SESSION_TYPES = new Set(["claude.leader", "claude.worker"]);
const WHOLE = ".";

/**
 * A resource as the run compares it: a path from the project root (an absolute
 * one inside the node's checkout is made relative to it), `/`-separated, with
 * no `./` or trailing `/`. A name such as `db:migrations` stays as it is.
 */
export const normalizeResource = (resource: string, cwd: string): string => {
  const trimmed = resource.trim().replaceAll("\\", "/");
  const fromCwd = path.relative(cwd, trimmed);
  const inside =
    path.isAbsolute(trimmed) &&
    !fromCwd.startsWith("..") &&
    !path.isAbsolute(fromCwd);
  const relative = inside ? fromCwd.split(path.sep).join("/") : trimmed;
  const normalized = path.posix.normalize(relative === "" ? WHOLE : relative);
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
};

/** Whether a claim on `a` covers `b`: the same, or a folder `b` is in. */
const covers = (a: string, b: string): boolean =>
  a === b || a === WHOLE || b.startsWith(`${a}/`);

/** Whether two claims cover any of the same thing. */
export const overlaps = (a: string, b: string): boolean =>
  covers(a, b) || covers(b, a);

/** What a node refused a claim sees once the claim in its way is released. */
export const releasedNotice = (resource: string, by: string): string =>
  `[ork] ${resource} was released by ${by}. Claim what you need again before you change it.`;

/** How many sessions may write at once, counting workers a leader may spawn. */
const writersOf = (graph: CompiledGraph): Set<string> => {
  const isolation = graph.workflow.defaults?.isolation ?? "worktree";
  const writers = new Set<string>();
  for (const [id, { node }] of graph.nodes) {
    if (!SESSION_TYPES.has(node.type)) continue;
    if ("isolation" in node && (node.isolation ?? isolation) === "readonly") {
      continue;
    }
    writers.add(id);
  }
  return writers;
};

const spawnable = (graph: CompiledGraph, writers: Set<string>): number => {
  let count = 0;
  for (const { node, children } of graph.nodes.values()) {
    if (node.type !== "claude.leader") continue;
    if (children.some(child => writers.has(child))) {
      count += node.maxWorkers ?? 0;
    }
  }
  return count;
};

export const createClaims = ({
  graph,
  onEvent,
  notify,
}: {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
  /** Pushes a line into a node's live session, if it has one. */
  notify: (node: string, text: string) => void;
}): ClaimRegistry => {
  const writers = writersOf(graph);
  const contended = writers.size + spawnable(graph, writers) > 1;
  /** Resource -> the node holding it. */
  const holders = new Map<string, string>();
  /** Held resource -> the nodes refused because of it. */
  const waiting = new Map<string, Set<string>>();

  const heldBy = (id: string): string[] =>
    [...holders].filter(([, holder]) => holder === id).map(([r]) => r);

  const drop = (
    resource: string,
    by: string,
    reason: "released" | "finished",
  ) => {
    holders.delete(resource);
    onEvent({ type: "claim.released", node: by, resource, reason });
    for (const node of waiting.get(resource) ?? []) {
      if (node !== by) notify(node, releasedNotice(resource, by));
    }
    waiting.delete(resource);
  };

  const port: ClaimRegistry["port"] = (id, template, cwd) => ({
    contended: () => contended && writers.has(template ?? id),
    claim: resource => {
      const wanted = normalizeResource(resource, cwd);
      const theirs = [...holders].find(
        ([r, holder]) => holder !== id && overlaps(r, wanted),
      );
      if (theirs !== undefined) {
        const [held, holder] = theirs;
        waiting.set(held, (waiting.get(held) ?? new Set()).add(id));
        onEvent({
          type: "claim.refused",
          node: id,
          resource: wanted,
          holder,
          held,
        });
        return {
          ok: false,
          error: `${holder} holds ${held === wanted ? wanted : `${held}, which overlaps ${wanted}`}. Work on something else, or ask ${holder} if you can reach it; Ork tells you when it is released`,
        };
      }
      const already = [...holders].some(
        ([r, holder]) => holder === id && covers(r, wanted),
      );
      if (!already) {
        holders.set(wanted, id);
        onEvent({ type: "claim.taken", node: id, resource: wanted });
      }
      return { ok: true, resource: wanted, already };
    },
    release: resource => {
      const wanted = normalizeResource(resource, cwd);
      if (holders.get(wanted) !== id) {
        const held = heldBy(id);
        return {
          ok: false,
          error: `you hold no claim on ${wanted}; you hold ${held.length === 0 ? "none" : held.join(", ")}`,
        };
      }
      drop(wanted, id, "released");
      return { ok: true, resource: wanted, already: false };
    },
    held: () => heldBy(id),
  });

  const releaseAll: ClaimRegistry["releaseAll"] = id => {
    for (const set of waiting.values()) set.delete(id);
    for (const [resource, holder] of holders) {
      if (holder === id) drop(resource, id, "finished");
    }
  };

  return { port, releaseAll };
};
