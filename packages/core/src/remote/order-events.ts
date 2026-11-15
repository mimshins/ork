/**
 * @file Holding followed events one window and releasing them in store order
 *   `(at, run, seq)`, so events of several runs that arrive out of order (one
 *   run polled later than another) reach the caller in the order they were
 *   stored (RFC-020).
 */

type Held<T> = {
  item: T;
  at: string;
  run: string;
  seq: number;
  /** When it was pushed, on the monotonic clock. */
  arrived: number;
};

export type Ordered<T> = {
  /** Holds `item`, event `seq` of `run`, stored at `at`. */
  push: (item: T, at: string, run: string, seq: number) => void;
  /** Releases everything held, sorted, now. */
  flush: () => void;
  /** Discards everything held and cancels the timer. */
  drop: () => void;
};

const text = (a: string, b: string): number => Number(a > b) - Number(a < b);

// shortcut: compares `at` across runs and relies on `at` never decreasing
// within a run (one clock, ADR-024); a clock step backwards could reverse two
// events of one run. Upgrade to a per-run k-way merge if that is ever seen.
const storeOrder = <T>(a: Held<T>, b: Held<T>): number =>
  text(a.at, b.at) || text(a.run, b.run) || a.seq - b.seq;

/**
 * Holds what `push` gets for `windowMs`, then calls `deliver` in store order.
 * On the timer, everything held is sorted and the prefix through the last item
 * held a full window is released: a younger item that sorts before it goes too,
 * the rest stay. A throw from `deliver` goes to `onError`, and the rest of that
 * release is dropped.
 */
export const createOrdered = <T>(
  deliver: (item: T) => void,
  windowMs: number,
  onError: (error: unknown) => void,
): Ordered<T> => {
  /** In arrival order: the first is the oldest. */
  let held: Held<T>[] = [];
  let timer: NodeJS.Timeout | undefined;

  const release = (ready: Held<T>[]): void => {
    for (const { item } of ready) {
      try {
        deliver(item);
      } catch (error) {
        onError(error);
        return;
      }
    }
  };
  const arm = (): void => {
    const [oldest] = held;
    if (oldest === undefined || timer !== undefined) return;
    const wait = Math.max(0, oldest.arrived + windowMs - performance.now());
    timer = setTimeout(tick, wait);
    timer.unref();
  };
  const tick = (): void => {
    timer = undefined;
    const due = performance.now() - windowMs;
    const sorted = held.toSorted(storeOrder);
    const count = sorted.findLastIndex(h => h.arrived <= due) + 1;
    const ready = sorted.slice(0, count);
    const out = new Set(ready);
    held = held.filter(h => !out.has(h));
    release(ready);
    arm();
  };
  const drop = (): void => {
    held = [];
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    push: (item, at, run, seq) => {
      held.push({ item, at, run, seq, arrived: performance.now() });
      arm();
    },
    flush: () => {
      const ready = held.toSorted(storeOrder);
      drop();
      release(ready);
    },
    drop,
  };
};
