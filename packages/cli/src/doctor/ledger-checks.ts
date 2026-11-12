/**
 * @file What `ork doctor` says of the machine's ledgers: it sweeps the records
 *   and tickets of processes that are gone from the heavy-command slots
 *   (ADR-080) and the locks (RFC-016), and names each one it removed. Says
 *   nothing when there were none.
 */

import { homedir } from "node:os";

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

/** Sweeps the slots and locks in `home`'s `~/.ork`; one line per kind swept. */
export const ledgerChecks = (home: string = homedir()): CheckResult[] => {
  const slots = machineSlotLedger({ home }).sweep();
  const locks = sweepLocks(machineLocksDir(home));
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
