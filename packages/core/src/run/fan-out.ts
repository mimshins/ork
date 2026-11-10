/**
 * @file Running a node once per item of a list (RFC-013): the activation of a
 *   node with `forEach` resolves its list, runs each entry as its own
 *   activation `<id>.<i>` (of the same declared node, through its type's own
 *   executor), and finishes once with the items' results gathered in list
 *   order. It reads only `forEach`, so an executor from the registry fans out
 *   with no change here.
 */

import type { ForEach, Node } from "@krapht/ork-schema";

import { type Scope, templatePath, templateValue } from "../expr/evaluate.ts";
import { declaredOutputOf } from "../graph/types.ts";
import { declaredProblem, unmasked } from "./declared.ts";
import type { StartHooks } from "./delegation.ts";
import { endFor, endOf, failedWith, type SessionEnd } from "./ended.ts";
import type { Activation, RunOptions } from "./handle.ts";
import type { Holds, Stops } from "./holds.ts";
import { spendsBudget, needsSlot, type Slots } from "./slots.ts";
import type { NodeOutput, NodeResult } from "./types.ts";

/** The node's `forEach`, whatever its type; `undefined` when it has none. */
export const forEachOf = (node: Node | undefined): ForEach | undefined =>
  node !== undefined && "forEach" in node ? node.forEach : undefined;

type FanOutDeps = StartHooks & {
  options: Pick<RunOptions, "onEvent" | "replay">;
  stops: Stops;
  scope: () => Scope;
  nodeOf: (activation: Activation) => Node | undefined;
  /** What a list over its cap runs, or `null` to stop the run. */
  loops: {
    overList: (
      node: string,
      list: unknown[],
      maxItems: number,
      round: number,
      signal: AbortSignal,
    ) => Promise<unknown[] | null>;
  };
};

/** The list a node runs over, or why there isn't one. */
const listOf = (
  forEach: ForEach,
  scope: Scope,
): { ok: true; list: unknown[] } | { ok: false; error: string } => {
  if ("items" in forEach) return { ok: true, list: forEach.items };
  const read = templateValue(forEach.from, scope);
  if (!read.ok) return read;
  const { value } = read;
  if (Array.isArray(value)) return { ok: true, list: value as unknown[] };
  const name = String(templatePath(forEach.from)?.at(-1) ?? forEach.from);
  // In the words of a declared field: `tasks is "fix it", expected a list`.
  return {
    ok: false,
    error:
      declaredProblem({ [name]: { list: {} } }, { [name]: value }) ??
      `${name} is not a list`,
  };
};

/** The output a `from` list comes from, whose freshness resume asks about. */
const sourceOf = (forEach: ForEach, scope: Scope): unknown => {
  if (!("from" in forEach)) return undefined;
  const [root, id] = templatePath(forEach.from) ?? [];
  return root === "nodes" ? scope.nodes[String(id)]?.output : undefined;
};

const isRecord = (value: unknown): value is NodeOutput =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What `results` keeps of an item: its declared fields (a program's are under
 * `json`), its summary, Ork's own branch and worktree, and how a program
 * failed. The full output stays in the item's own `node.finished`.
 */
const entryOf = (
  declared: Readonly<Record<string, unknown>> | undefined,
  { ok, output, error }: NodeResult,
): NodeOutput => {
  const json = isRecord(output["json"]) ? output["json"] : {};
  const fields = Object.keys(declared ?? {}).map((field): [string, unknown] => [
    field,
    Object.hasOwn(json, field) ? json[field] : output[field],
  ]);
  const own = ["summary", "branch", "worktree", "merge"].map(
    (field): [string, unknown] => [field, output[field]],
  );
  const failed: [string, unknown][] =
    !ok && typeof output["exitCode"] === "number"
      ? [
          ["exitCode", output["exitCode"]],
          ["error", error],
        ]
      : [];
  return Object.fromEntries(
    [...fields, ...own, ...failed].filter(([, value]) => value !== undefined),
  );
};

/** Whether an item passed but its work could not reach its owner. */
const mergeFailed = ({ output }: NodeResult): boolean =>
  isRecord(output["merge"]) && output["merge"]["ok"] === false;

const statusOf = (result: NodeResult): string => {
  if (mergeFailed(result)) return "fail";
  const { ok, output } = result;
  const status = output["status"];
  if (typeof status === "string") return status;
  return ok ? "pass" : "fail";
};

/** Why a fan-out did not succeed, naming the first item that failed. */
const whyNot = (
  count: number,
  failures: readonly string[],
  skipped: number,
): string => {
  const parts = [`${String(failures.length)} of ${String(count)} items failed`];
  const [first] = failures;
  if (first !== undefined) parts[0] = `${parts[0] ?? ""}; first, ${first}`;
  if (skipped > 0) parts.push(`${String(skipped)} not started`);
  return parts.join("; ");
};

/**
 * Waits until the item may start: not while it is held, and without keeping a
 * session slot through a pause, which would stop other nodes.
 */
const awaitTurn = async (
  hold: ReturnType<Holds["forNode"]>,
  slots: Slots | null,
  signal: AbortSignal,
): Promise<void> => {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- one wait at a time
    await hold.wait("start", signal);
    if (slots === null) return;
    // oxlint-disable-next-line no-await-in-loop -- one wait at a time
    await slots.take();
    if (!hold.held() || signal.aborted) return;
    slots.release();
  }
};

export const createFanOut = (deps: FanOutDeps) => {
  const { holds, slots, stops, nodeOf, perform, options } = deps;

  return async (
    activation: Activation,
    forEach: ForEach,
    round: number,
  ): Promise<NodeResult> => {
    const { id, input } = activation;
    const scope = deps.scope();
    const recorded =
      options.replay?.listed?.(id, round, sourceOf(forEach, scope)) ?? null;
    const listed: ReturnType<typeof listOf> =
      recorded === null
        ? listOf(forEach, scope)
        : { ok: true, list: unmasked(forEach, recorded) };
    if (!listed.ok) {
      return failedWith(endFor("invalid_node", { reason: listed.error }));
    }
    let { list } = listed;
    const recordList = (): void => {
      options.onEvent({
        type: "each.listed",
        node: id,
        round,
        count: list.length,
        list,
        ...(recorded === null && options.replay !== undefined
          ? { anew: true as const }
          : {}),
      });
    };
    recordList();
    // Before the wait over the cap, which a stop has to be able to end.
    const signal = stops.signalFor(id);
    if ("maxItems" in forEach && list.length > forEach.maxItems) {
      options.onEvent({
        type: "each.exceeded",
        node: id,
        round,
        count: list.length,
        maxItems: forEach.maxItems,
      });
      const chosen = await deps.loops.overList(
        id,
        list,
        forEach.maxItems,
        round,
        signal,
      );
      if (chosen === null) {
        const reason = `the list of ${id} has ${String(list.length)} items, over maxItems ${String(forEach.maxItems)}`;
        // No one let it run that many: the workflow's list is over its cap.
        return stops.ended(id, {
          ...failedWith(endFor("invalid_node", { reason }), {
            status: "fail",
            summary: reason,
          }),
          limited: reason,
          stopsAs: "failed",
        });
      }
      const narrowed = chosen.length !== list.length;
      list = chosen;
      // What runs is what's counted, and what a resume hands back.
      if (narrowed) recordList();
    }
    const node = nodeOf(activation);
    const session = node !== undefined && needsSlot(node);
    const spends = node !== undefined && spendsBudget(node);
    const declared = node === undefined ? undefined : declaredOutputOf(node);
    const results: NodeOutput[] = list.map(() => ({}));
    const statuses: string[] = list.map(() => "skipped");
    const failures: string[] = [];
    /** How the first item that failed ended: the fanned node's own end. */
    let firstEnd: SessionEnd | undefined;

    const mayStart = (): boolean =>
      !signal.aborted &&
      !deps.isStopped() &&
      (forEach.onFailure !== "stop" || failures.length === 0);

    const runItem = async (index: number): Promise<void> => {
      const itemId = `${id}.${String(index)}`;
      const hold = holds.forNode(itemId, id);
      await awaitTurn(hold, session ? slots : null, signal);
      try {
        if (!mayStart() || (spends && deps.budgetSpent())) return;
        const result = await perform({
          id: itemId,
          input,
          template: id,
          item: { of: id, index, value: list[index] },
          round,
        });
        results[index] = entryOf(declared, result);
        statuses[index] = statusOf(result);
        if (!result.ok) {
          firstEnd ??= endOf(result);
          failures.push(`${itemId}: ${result.error ?? "failed"}`);
        } else if (mergeFailed(result)) {
          failures.push(`${itemId}: its work could not be merged`);
        }
      } finally {
        if (session) slots.release();
      }
    };

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < list.length && mayStart()) {
        const index = next;
        next += 1;
        // oxlint-disable-next-line no-await-in-loop -- each worker is one lane
        await runItem(index);
      }
    };
    const lanes = Math.min(forEach.maxParallel ?? slots.limit, list.length);
    await Promise.all(Array.from({ length: lanes }, () => worker()));

    const skipped = statuses.filter(status => status === "skipped").length;
    const ok = failures.length === 0 && skipped === 0;
    const gathered: NodeResult = {
      ok,
      output: { items: list, results, statuses, count: list.length },
      ...(ok ? {} : { error: whyNot(list.length, failures, skipped) }),
      ...(ok || firstEnd === undefined ? {} : { end: firstEnd }),
      // Cut off, not failed: it fires no `notify:`, and resume goes on.
      ...(!ok && deps.isStopped()
        ? { limited: deps.reasons[0] ?? "the run stopped" }
        : {}),
    };
    // A stopped node fails, and keeps what its items gathered.
    return { ...stops.ended(id, gathered), output: gathered.output };
  };
};

export type FanOut = ReturnType<typeof createFanOut>;
