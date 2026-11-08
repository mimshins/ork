/**
 * @file Session slots: at most `limits.concurrency` Claude sessions run at
 *   once. Queued activations take a free slot when the scheduler pumps;
 *   delegated children and leaders returning from `delegate` wait for one and
 *   are served first, so a leader waiting on its children never holds a slot
 *   they need.
 */

import { isClaudeNode, type Node } from "@krapht/ork-schema";

/** Only a Claude session takes a slot; tools and gates are not limited. */
export const needsSlot = (node: Node): boolean => isClaudeNode(node);

/** A call spends through its run, so it needs budget as a session does. */
export const spendsBudget = (node: Node): boolean =>
  needsSlot(node) || node.type === "workflow.call";

export type Slots = {
  /** At most this many sessions at once: `limits.concurrency`. */
  limit: number;
  /** Takes a slot if one is free and nobody is waiting for it. */
  tryTake: () => boolean;
  /** Waits for a slot. */
  take: () => Promise<void>;
  release: () => void;
};

export const createSlots = (limit: number, onFree: () => void): Slots => {
  let used = 0;
  const waiting: (() => void)[] = [];

  return {
    limit,
    tryTake: () => {
      if (used >= limit || waiting.length > 0) return false;
      used += 1;
      return true;
    },
    take: () => {
      if (used < limit && waiting.length === 0) {
        used += 1;
        return Promise.resolve();
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push(resolve);
      return promise;
    },
    release: () => {
      // A waiter inherits the slot, so `used` stays the same.
      const next = waiting.shift();
      if (next === undefined) {
        used -= 1;
        onFree();
      } else {
        next();
      }
    },
  };
};
