/**
 * @file Session slots: at most `limits.concurrency` Claude sessions run at
 *   once. Queued activations take a free slot when the scheduler pumps;
 *   delegated children and leaders returning from `delegate` wait for one and
 *   are served first, so a leader waiting on its children never holds a slot
 *   they need.
 */

export type Slots = {
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
