/**
 * @file A run's locks (RFC-016): a node that names a lock takes it from the
 *   machine's ledger before it runs, or joins the run's hold when the run has
 *   it already. The hold spans nodes: it goes when a node naming it ends and no
 *   node the graph can still reach from there names it, and on every end of the
 *   run. A fanned node's items each take and release it (unless the run already
 *   holds it). A wait is never silent: `lock.waiting` names the holders, and
 *   the node's, its owners' and the run's clocks stand still meanwhile.
 */

import { parseTemplate, renderTemplate, type Scope } from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { LockLedgers } from "../machine/lock-ledger.ts";
import { forEachOf } from "./fan-out.ts";
import type { Activation } from "./handle.ts";
import type { NodeItem, RunEvent } from "./types.ts";

export type RunLocks = {
  /**
   * Before an activation runs: takes its node's lock, or joins the run's hold.
   * False when the wait was cut off (the node or the run stopped).
   */
  enter: (activation: Activation, signal: AbortSignal) => Promise<boolean>;
  /** After it ran: lets the lock go when nothing later names it. */
  leave: (activation: Activation) => void;
  /** The run ends: every lock it still holds goes. */
  end: () => void;
};

/** A wait for a lock, as `ork ps`, `ork logs`, `ork tree` and the UI say it. */
export const lockWaitLine = (
  lock: string,
  holders: readonly string[],
): string =>
  holders.length === 0
    ? `waiting for ${lock}`
    : `waiting for ${lock}, held by ${holders.join(", ")}`;

type Deps = {
  graph: CompiledGraph;
  ledgers: LockLedgers | undefined;
  runId: string;
  scope: (item?: NodeItem) => Scope;
  onEvent: (event: RunEvent) => void;
  /** Stands the node's clock (its owners' and the run's) still for `wait`. */
  waitFor: <T>(id: string, wait: () => Promise<T>) => Promise<T>;
};

type Span = {
  taking: Promise<(() => void) | null>;
  users: Set<string>;
  /** The last node to run under it, which a release at the run's end names. */
  last: string;
  release?: () => void;
};

/** The node an activation is of: an item's or a worker's declared node. */
const declaredOf = (activation: Activation): string =>
  activation.item?.of ?? activation.template ?? activation.id;

export const createRunLocks = (deps: Deps): RunLocks => {
  const { graph, ledgers, onEvent, runId } = deps;
  /** The run's holds across nodes, by lock name. */
  const spans = new Map<string, Span>();
  /** Each activation running under a lock; an item's own release with it. */
  const entered = new Map<string, { lock: string; release?: () => void }>();
  let ended = false;

  const nameOf = (id: string, item?: NodeItem): string | undefined => {
    const node = graph.nodes.get(id)?.node;
    const lock = node !== undefined && "lock" in node ? node.lock : undefined;
    if (lock === undefined) return undefined;
    const parsed = parseTemplate(lock);
    return parsed.ok ? renderTemplate(parsed.parts, deps.scope(item)) : lock;
  };

  /** Whether a node the graph can reach from `from` names `lock` itself. */
  const laterNamed = (from: string, lock: string): boolean => {
    const seen = new Set<string>();
    const next = [from];
    for (let id = next.pop(); id !== undefined; id = next.pop()) {
      for (const { to } of graph.nodes.get(id)?.outgoing ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        // A fanned node's items hold it each in turn, not the run.
        const fanned = forEachOf(graph.nodes.get(to)?.node) !== undefined;
        if (!fanned && nameOf(to) === lock) return true;
        next.push(to);
      }
    }
    return false;
  };

  const take = async (
    id: string,
    lock: string,
    ledger: NonNullable<Deps["ledgers"]>,
    signal: AbortSignal,
  ): Promise<(() => void) | null> => {
    const slots = await ledger.of(lock);
    const release = await deps.waitFor(id, () =>
      slots.take(
        { run: runId, node: id, pid: process.pid },
        {
          signal,
          onWait: holders => {
            onEvent({
              type: "lock.waiting",
              id,
              lock,
              holders: holders.map(held => `${held.run}/${held.node}`),
            });
          },
        },
      ),
    );
    // Taken as the run ended: nothing will run under it.
    if (release !== null && ended) {
      release();
      return null;
    }
    return release;
  };

  /** Joins the run's hold of `lock`, taking it first when nobody has. */
  const join = async (
    id: string,
    lock: string,
    ledger: LockLedgers,
    signal: AbortSignal,
  ): Promise<boolean> => {
    for (;;) {
      let span = spans.get(lock);
      if (span === undefined) {
        span = {
          taking: take(id, lock, ledger, signal),
          users: new Set(),
          last: id,
        };
        spans.set(lock, span);
      }
      span.users.add(id);
      span.last = id;
      let release: (() => void) | null;
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one take at a time
        release = await span.taking;
      } catch (error) {
        if (spans.get(lock) === span) spans.delete(lock);
        throw error;
      }
      if (release !== null) {
        span.release = release;
        return true;
      }
      // The node that was taking it stopped: take it anew, unless this did too.
      span.users.delete(id);
      if (spans.get(lock) === span) spans.delete(lock);
      if (signal.aborted || ended) return false;
    }
  };

  const released = (id: string, lock: string, end: "span" | "run"): void => {
    onEvent({ type: "lock.released", id, lock, end });
  };

  return {
    enter: async (activation, signal) => {
      const { id, item } = activation;
      const lock = nameOf(declaredOf(activation), item);
      if (lock === undefined || ledgers === undefined) return true;
      if (item === undefined || spans.has(lock)) {
        if (!(await join(id, lock, ledgers, signal))) return false;
        entered.set(id, { lock });
      } else {
        const release = await take(id, lock, ledgers, signal);
        if (release === null) return false;
        entered.set(id, { lock, release });
      }
      onEvent({ type: "lock.taken", id, lock });
      return true;
    },
    leave: activation => {
      const { id } = activation;
      const held = entered.get(id);
      if (held === undefined) return;
      entered.delete(id);
      const { lock, release } = held;
      if (release !== undefined) {
        release();
        released(id, lock, "span");
        return;
      }
      const span = spans.get(lock);
      if (span === undefined) return;
      span.users.delete(id);
      if (span.users.size > 0 || laterNamed(declaredOf(activation), lock)) {
        return;
      }
      spans.delete(lock);
      span.release?.();
      released(id, lock, "span");
    },
    end: () => {
      ended = true;
      for (const [id, { lock, release }] of entered) {
        if (release === undefined) continue;
        release();
        released(id, lock, "run");
      }
      entered.clear();
      for (const [lock, span] of spans) {
        if (span.release === undefined) continue;
        span.release();
        released(span.last, lock, "run");
      }
      spans.clear();
    },
  };
};
