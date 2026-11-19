/**
 * @file A benchmark's fresh-session counts (specs/scheduler/fresh-sessions.md):
 *   per worker node, how many activations the `sessions.freshOver` rule started
 *   fresh (`node.started` with `fresh`), the context of the session before each
 *   delegation, and the would-fires: delegations after a `done` activation
 *   whose context was over the threshold, which a run with the rule `never`
 *   records too, so an A/B pair can be checked. A run from before the rule has
 *   no `contextTokens` or `fresh`, and counts zeros.
 */

import { rec, text } from "./json.ts";
import type { Tree } from "./tree.ts";

/** The threshold of the estimate, used when no activation records the rule's. */
export const DEFAULT_OVER = 100_000;

type NodeCounts = {
  fires: number;
  would_fires: number;
  /** The previous session's context at each delegated start, in order. */
  contexts: number[];
};

/** The last finished activation of a node: whether it ended `done`, its context. */
type Last = { done: boolean; contextTokens?: number };

/**
 * Fires and would-fires by `<workflow>.<node>`. The threshold is the run's own
 * `fresh.over` when a fire recorded one, else `DEFAULT_OVER`.
 */
export const freshSessionsOf = (tree: Pick<Tree, "runs" | "events">) => {
  const workflows = new Map(tree.runs.map(r => [r.id, r.workflow]));
  const recorded = tree.events
    .map(e => rec(e.data["fresh"])["over"])
    .find(v => typeof v === "number");
  const over = typeof recorded === "number" ? recorded : DEFAULT_OVER;
  const last = new Map<string, Last>();
  const byNode = new Map<string, NodeCounts>();
  for (const e of tree.events) {
    const id = text(e.data["id"]) ?? e.node ?? "";
    const key = `${e.run}/${id}`;
    // A resumed run knows no earlier sessions, as the scheduler does not.
    if (e.type === "run.resumed") {
      for (const k of last.keys())
        if (k.startsWith(`${e.run}/`)) last.delete(k);
    }
    if (e.type === "node.finished") {
      const kind = text(rec(e.data["end"])["kind"]);
      const tokens = rec(e.data["usage"])["contextTokens"];
      last.set(key, {
        done: kind === undefined ? e.data["ok"] === true : kind === "done",
        ...(typeof tokens === "number" ? { contextTokens: tokens } : {}),
      });
    }
    if (e.type !== "node.started") continue;
    const worker = (text(e.data["nodeType"]) ?? "").endsWith(".worker");
    const fresh = e.data["fresh"] !== undefined;
    const before = last.get(key);
    const delegation =
      worker &&
      e.data["owner"] !== undefined &&
      before?.done === true &&
      before.contextTokens !== undefined;
    if (!fresh && !delegation) continue;
    const name = `${workflows.get(e.run) ?? ""}.${id}`;
    const counts = byNode.get(name) ?? {
      fires: 0,
      would_fires: 0,
      contexts: [],
    };
    byNode.set(name, counts);
    if (fresh) counts.fires += 1;
    if (delegation && before.contextTokens !== undefined) {
      counts.contexts.push(before.contextTokens);
      if (before.contextTokens > over) counts.would_fires += 1;
    }
  }
  const nodes = [...byNode.values()];
  return {
    over,
    fires: nodes.reduce((s, n) => s + n.fires, 0),
    would_fires: nodes.reduce((s, n) => s + n.would_fires, 0),
    by_node: Object.fromEntries(byNode),
  };
};
