/**
 * @file A node's share of the machine (the `machine` of its context): the
 *   project's priority for its commands, and a machine-wide slot around each
 *   heavy one. A wait is never silent: `slot.waiting` names who holds the
 *   slots, `slot.taken` ends it, and the node's clock (its owners' and the
 *   run's too) stands still meanwhile, so a timeout counts from the slot.
 */

import { isHeavy, isHeavyScript } from "../project/heavy.ts";
import type { MachinePort } from "../runtime/machine-port.ts";
import type { HoldPort } from "../runtime/types.ts";
import type { RunOptions } from "./handle.ts";
import type { createClock } from "./timeouts.ts";

/** A wait for a slot, as `ork logs`, `ork tree` and the UI say it. */
export const slotWaitLine = (holders: readonly string[]): string =>
  holders.length === 0
    ? "waiting for a check slot"
    : `waiting for a check slot, held by ${holders.join(", ")}`;

/** The run's clock, as far as a slot wait stands it still. */
export type SlotWaitClock = Pick<ReturnType<typeof createClock>, "waitFor">;

const none = (): void => {
  // Nothing was taken.
};

/** The port for one activation; none for a run that shares nothing. */
export const machinePort = (
  options: Pick<RunOptions, "machine" | "onEvent">,
  runId: string,
  id: string,
  clock: SlotWaitClock,
): MachinePort | undefined => {
  const { machine } = options;
  if (machine === undefined) return undefined;
  const { rules, ledger } = machine;
  return {
    priority: rules.priority,
    slot: async (command, signal, run) => {
      const heavy =
        isHeavy(rules.heavy, command) ||
        (run?.script !== undefined && isHeavyScript(rules.heavy, run.script));
      if (ledger === undefined || !heavy) return none;
      let waited = false;
      const release = await clock.waitFor(id, () =>
        ledger.take(
          { run: runId, node: id, pid: process.pid },
          {
            signal,
            onWait: holders => {
              waited = true;
              options.onEvent({
                type: "slot.waiting",
                id,
                holders: holders.map(held => `${held.run}/${held.node}`),
              });
            },
          },
        ),
      );
      if (release === null) return none;
      if (waited) options.onEvent({ type: "slot.taken", id });
      return release;
    },
  };
};

type Clock = Pick<HoldPort, "held" | "watch">;

/**
 * A step's clock that also stands still while its command waits for a slot, and
 * the machine port that tells it so; for a step's own timeout.
 */
export const slotClock = (
  base: Clock | undefined,
  machine: MachinePort | undefined,
): { clock: Clock; machine: MachinePort | undefined } => {
  let waiting = 0;
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    clock: {
      held: () => waiting > 0 || base?.held() === true,
      watch: listener => {
        listeners.add(listener);
        const unwatch = base?.watch(listener);
        return () => {
          listeners.delete(listener);
          unwatch?.();
        };
      },
    },
    machine:
      machine === undefined
        ? undefined
        : {
            ...machine,
            slot: async (command, signal, run) => {
              waiting += 1;
              tell();
              try {
                return await machine.slot(command, signal, run);
              } finally {
                waiting -= 1;
                tell();
              }
            },
          },
  };
};
