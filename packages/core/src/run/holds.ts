/**
 * @file A run's live controls (ADR-041). Its holds: whether the whole run is
 *   paused, which nodes are, and a hold port per node that a session waits on
 *   at its next tool call. The first wait of a hold records `node.held`, and
 *   the hold's end `node.released` (a wait given up, as when a session defers
 *   its tool call, leaves the node held); every change tells the scheduler,
 *   which starts what was waiting. A timer that counts only while its node is
 *   not held, for a gate's timeout. And its stops: each running activation has
 *   its own abort beside the run's, and one the user stopped fails, "stopped by
 *   the user", after which the run's own rules apply as to any failure.
 */

import type { HoldPoint, HoldPort } from "../runtime/types.ts";
import { endFor, failedWith } from "./ended.ts";
import type { NodeResult, RunEvent } from "./types.ts";

export type Holds = {
  /** Pauses the run (no `node`) or one node; false when it already was. */
  pause: (node?: string) => boolean;
  /** Releases a pause; the run's releases its nodes too. False when none. */
  proceed: (node?: string) => boolean;
  runPaused: () => boolean;
  /** Whether an activation of `id` (an instance of `template`) is held. */
  isHeld: (id: string, template?: string) => boolean;
  /** The hold port of one activation. */
  forNode: (id: string, template?: string) => HoldPort;
  /** An activation ended: it is no longer held, whatever it waited on. */
  finished: (id: string) => void;
  /** Calls `listener` whenever a hold may have changed; returns its undo. */
  watch: HoldPort["watch"];
};

type Waiter = { id: string; release: () => void };

export const createHolds = (options: {
  onEvent: (event: RunEvent) => void;
  /** Something may start now: the scheduler pumps its queue. */
  onChange: () => void;
}): Holds => {
  let paused = false;
  const nodes = new Set<string>();
  const listeners = new Set<() => void>();
  const waiters = new Set<Waiter>();
  /** Nodes with a recorded `node.held` and no `node.released` yet. */
  const recorded = new Set<string>();
  /** Each waiting activation's template, for `isHeld`. */
  const templates = new Map<string, string | undefined>();

  const isHeld = (id: string, template?: string): boolean =>
    paused || nodes.has(id) || (template !== undefined && nodes.has(template));

  // After the current task, so the command that caused it is recorded first.
  const changed = (): void => {
    queueMicrotask(() => {
      for (const listener of listeners) listener();
      for (const waiter of waiters) {
        if (!isHeld(waiter.id, templates.get(waiter.id))) waiter.release();
      }
      // A node that gave up its wait (its session deferred) is released too.
      for (const id of recorded) {
        if (!isHeld(id, templates.get(id))) {
          recorded.delete(id);
          options.onEvent({ type: "node.released", id });
        }
      }
      options.onChange();
    });
  };

  const watch: HoldPort["watch"] = listener => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const forNode = (id: string, template?: string): HoldPort => {
    templates.set(id, template);
    const held = () => isHeld(id, template);
    return {
      held,
      watch,
      wait: (at: HoldPoint, signal?: AbortSignal) => {
        if (!held() || signal?.aborted === true) return Promise.resolve();
        const { promise, resolve } = Promise.withResolvers<void>();
        const waiter: Waiter = {
          id,
          release: () => {
            waiters.delete(waiter);
            signal?.removeEventListener("abort", waiter.release);
            resolve();
          },
        };
        waiters.add(waiter);
        // Giving up the wait leaves the node held: it is still paused.
        signal?.addEventListener("abort", waiter.release, { once: true });
        if (!recorded.has(id)) {
          recorded.add(id);
          options.onEvent({ type: "node.held", id, at });
        }
        return promise;
      },
    };
  };

  return {
    pause: node => {
      if (node === undefined) {
        if (paused) return false;
        paused = true;
      } else {
        if (nodes.has(node)) return false;
        nodes.add(node);
      }
      changed();
      return true;
    },
    proceed: node => {
      if (node === undefined) {
        if (!paused && nodes.size === 0) return false;
        paused = false;
        nodes.clear();
      } else if (!nodes.delete(node)) {
        return false;
      }
      changed();
      return true;
    },
    runPaused: () => paused,
    isHeld,
    forNode,
    watch,
    finished: id => {
      recorded.delete(id);
      templates.delete(id);
    },
  };
};

/**
 * Waits `ms`, counting only while `hold` is not held: a paused run's gate keeps
 * the time it had left. True when the time ran out; false when `signal` aborted
 * first.
 */
export const heldTimeout = (
  hold: Pick<HoldPort, "held" | "watch"> | undefined,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> => {
  if (signal.aborted) return Promise.resolve(false);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let left = ms;
  let since = 0;
  let timer: NodeJS.Timeout | undefined;
  const end = (elapsed: boolean) => {
    clearTimeout(timer);
    unwatch?.();
    signal.removeEventListener("abort", aborted);
    resolve(elapsed);
  };
  const aborted = () => {
    end(false);
  };
  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    left -= Date.now() - since;
  };
  const go = () => {
    if (timer !== undefined) return;
    since = Date.now();
    timer = setTimeout(
      () => {
        end(true);
      },
      Math.max(0, left),
    );
  };
  const unwatch = hold?.watch(() => {
    if (hold.held()) pause();
    else go();
  });
  signal.addEventListener("abort", aborted, { once: true });
  if (hold?.held() !== true) go();
  return promise;
};

export type Stops = {
  /** The signal of one activation: the run's, or its own stop. */
  signalFor: (id: string, template?: string) => AbortSignal;
  /** Stops every running activation of `node` (or instance of it). */
  stop: (node: string) => boolean;
  /** An activation ended: its result, failed if the user stopped it. */
  ended: (id: string, result: NodeResult) => NodeResult;
};

export const createStops = (run: AbortSignal): Stops => {
  const own = new Map<
    string,
    { controller: AbortController; template: string | undefined }
  >();
  const stopped = new Set<string>();
  return {
    signalFor: (id, template) => {
      const controller = new AbortController();
      own.set(id, { controller, template });
      return AbortSignal.any([run, controller.signal]);
    },
    stop: node => {
      let found = false;
      for (const [id, { controller, template }] of own) {
        if (id !== node && template !== node) continue;
        found = true;
        stopped.add(id);
        controller.abort();
      }
      return found;
    },
    ended: (id, result) => {
      own.delete(id);
      return stopped.delete(id)
        ? {
            ...result,
            ...failedWith(endFor("interrupted"), {
              status: "fail",
              summary: "stopped by the user",
            }),
          }
        : result;
    },
  };
};
