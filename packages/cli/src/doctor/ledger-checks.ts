/**
 * @file What `ork doctor` says of the machine's ledgers: it sweeps the records
 *   and tickets of processes that are gone from the heavy-command slots
 *   (ADR-080) and the locks (RFC-016), and names each one it removed. Says
 *   nothing when there were none.
 */

import { readdirSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  type HeldSlot,
  machineLocksDir,
  machineSlotLedger,
  sweepLocks,
} from "@krapht/ork-core";
import type { CheckResult } from "@krapht/ork-integrations";

const named = (held: readonly HeldSlot[]): string =>
  held
    .map(({ run, node, pid }) => `${run}/${node} (pid ${String(pid)})`)
    .join(", ");

/** Removes `dir`'s `queue` folder when sweeping left it empty (else it stays). */
const dropEmptyQueue = (dir: string): void => {
  try {
    rmdirSync(path.join(dir, "queue"));
  } catch {
    // Missing, or not empty: a live waiter's ticket is in it.
  }
};

/**
 * Sweeps the slots and locks in `home`'s `~/.ork`; one line per kind swept, and
 * the empty `queue/` folders the sweep left are removed.
 */
export const ledgerChecks = (home: string = homedir()): CheckResult[] => {
  const slots = machineSlotLedger({ home }).sweep();
  const locksDir = machineLocksDir(home);
  const locks = sweepLocks(locksDir);
  // shortcut: a waiter that makes its queue folder between the sweep and this
  // removal fails once; upgrade to a lock if that shows.
  if (slots.length > 0) dropEmptyQueue(path.join(home, ".ork", "slots"));
  if (locks.length > 0) {
    for (const folder of readdirSync(locksDir)) {
      dropEmptyQueue(path.join(locksDir, folder));
    }
  }
  return [
    ...(slots.length === 0
      ? []
      : [
          {
            name: "check slots",
            status: "ok" as const,
            detail: `removed stale records of ${named(slots)}`,
          },
        ]),
    ...(locks.length === 0
      ? []
      : [
          {
            name: "locks",
            status: "ok" as const,
            detail: `removed stale records of ${named(locks)}`,
          },
        ]),
  ];
};
