/**
 * @file How a node's start and its waits for the machine read in `ork logs`: a
 *   start (with a line more when the `sessions.freshOver` rule or a changed
 *   driver began a fresh session), a slot for a heavy command (ADR-080) and a
 *   lock (RFC-016), each naming who holds it.
 */

import {
  lockWaitLine,
  maskSecrets,
  type RunEvent,
  slotWaitLine,
} from "@krapht/ork-core";

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

/** The lines for a node's start; `tag` leads the first, `blank` the next. */
export const formatStarted = (
  event: Extract<RunEvent, { type: "node.started" }>,
  tag: string,
  blank: string,
  dim: (text: string) => string,
): string[] => {
  const round = event.round > 1 ? ` (round ${String(event.round)})` : "";
  const owner = event.owner === undefined ? "" : `, for ${event.owner}`;
  const named =
    event.description === undefined
      ? ""
      : ` · ${maskSecrets(event.description)}`;
  const { fresh, driverChanged } = event;
  const because = [
    ...(fresh === undefined
      ? []
      : [
          `${blank} ${dim(`starts a fresh session: context ${String(fresh.contextTokens)} tokens over ${String(fresh.over)}`)}`,
        ]),
    ...(driverChanged === undefined
      ? []
      : [
          `${blank} ${dim(`starts a fresh session: driver changed from ${driverChanged.from} to ${driverChanged.to}`)}`,
        ]),
  ];
  return [
    `${tag} ${dim(`${event.nodeType}${round}${owner}${named}`)}`,
    ...because,
  ];
};
