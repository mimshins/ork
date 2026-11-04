/**
 * @file One `ork watch` per machine (RFC-011), held in the store so that taking
 *   it is one transaction. A holder whose process has gone, or whose id another
 *   process has since been given, doesn't hold anything.
 */

import { stillTheSameProcess } from "../store/process-age.ts";
import type { TriggerStore } from "../store/trigger-types.ts";

type LockStore = Pick<
  TriggerStore,
  "watchHolder" | "takeWatchHolder" | "releaseWatchHolder"
>;

/** The process that's watching, if one is. */
export const watchingPid = (store: LockStore): number | undefined => {
  const holder = store.watchHolder();
  return holder !== undefined && stillTheSameProcess(holder.pid, holder.at)
    ? holder.pid
    : undefined;
};

/** Takes the lock; the process holding it if it's taken. */
export const takeWatchLock = (
  store: LockStore,
  pid: number = process.pid,
): { ok: true; release: () => void } | { ok: false; pid: number } => {
  const inTheWay = store.takeWatchHolder(
    { pid, at: new Date().toISOString() },
    holder => stillTheSameProcess(holder.pid, holder.at),
  );
  if (inTheWay !== null) return { ok: false, pid: inTheWay.pid };
  return {
    ok: true,
    release: () => {
      store.releaseWatchHolder(pid);
    },
  };
};
