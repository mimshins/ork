/**
 * @file How a node shares the machine with other runs: the priority its
 *   commands and sessions start at, the slots its heavy commands take
 *   (`run/machine.ts`), and the CPU a command used.
 */

import type { Priority } from "@krapht/ork-schema";

/** CPU time, user and system, in milliseconds. */
export type CpuTime = { userMs: number; systemMs: number };

/** How a node's commands share the machine with other runs (`run/machine.ts`). */
export type MachinePort = {
  priority: Priority;
  /**
   * Takes a slot when `command` is heavy, first come; resolves with its
   * release.
   */
  slot: (command: string, signal: AbortSignal) => Promise<() => void>;
};
