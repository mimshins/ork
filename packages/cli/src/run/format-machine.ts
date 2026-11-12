/**
 * @file How a node's waits for the machine read in `ork logs`: a slot for a
 *   heavy command (ADR-080) and a lock (RFC-016), each naming who holds it.
 */

import { lockWaitLine, type RunEvent, slotWaitLine } from "@krapht/ork-core";

import type { Format } from "./view.ts";

type MachineEvent = Extract<
  RunEvent,
  { type: `slot.${string}` | `lock.${string}` }
>;

/** Whether `event` is a slot's or a lock's. */
export const isMachineEvent = (event: RunEvent): event is MachineEvent =>
  event.type.startsWith("slot.") || event.type.startsWith("lock.");

/** A slot or lock event's line, after its node's tag. */
export const machineLine = (
  event: MachineEvent,
  style: (format: Format, text: string) => string,
): string => {
  if (event.type === "slot.waiting") {
    return style("yellow", `‖ ${slotWaitLine(event.holders)}`);
  }
  if (event.type === "slot.taken") return style("dim", "▸ got a check slot");
  if (event.type === "lock.waiting") {
    return style("yellow", `‖ ${lockWaitLine(event.lock, event.holders)}`);
  }
  if (event.type === "lock.taken") {
    return style("dim", `▸ holds ${event.lock}`);
  }
  return style("dim", `▸ let ${event.lock} go`);
};
