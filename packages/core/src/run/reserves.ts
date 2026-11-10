/**
 * @file What running sessions have set aside of a run's budget (ADR-077). A
 *   session's cost is known only when it ends, so each one reserves the cap it
 *   was given as it starts, and what the next session is offered leaves the
 *   reserves out. A reserve never ends a run; it only shrinks what others are
 *   offered. A node with nothing left to it waits for a worker's reserve to
 *   free, never a leader's, which may be waiting on that very node.
 */

type Reserve = { usd: number; waitable: boolean };

export const createReserves = () => {
  const held = new Map<string, Reserve>();
  const waiters = new Set<() => void>();
  const wake = (): void => {
    const woken = [...waiters];
    waiters.clear();
    for (const resolve of woken) resolve();
  };
  return {
    /** All that is set aside now. */
    total: (): number =>
      [...held.values()].reduce((sum, reserve) => sum + reserve.usd, 0),
    /**
     * `id` sets aside `usd` (nothing, or 0, lets it go). `waitable` is false
     * for a leader, whose children must never wait on it.
     */
    reserve: (id: string, usd: number | undefined, waitable: boolean): void => {
      const before = held.get(id)?.usd ?? 0;
      if (usd === undefined || usd <= 0) held.delete(id);
      else held.set(id, { usd, waitable });
      if ((usd ?? 0) < before) wake();
    },
    /** The node ended: whatever it still held is let go. */
    drop: (id: string): void => {
      if (held.delete(id)) wake();
    },
    /**
     * Waits until a reserve shrinks. `false` at once when no other node holds
     * one worth waiting on, or when `signal` aborts.
     */
    freed: (id: string, signal: AbortSignal): Promise<boolean> => {
      const worth = [...held].some(
        ([other, reserve]) => other !== id && reserve.waitable,
      );
      if (!worth || signal.aborted) return Promise.resolve(false);
      return new Promise(resolve => {
        const done = (freed: boolean) => () => {
          waiters.delete(onFree);
          signal.removeEventListener("abort", onAbort);
          resolve(freed);
        };
        const onFree = done(true);
        const onAbort = done(false);
        waiters.add(onFree);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
};
