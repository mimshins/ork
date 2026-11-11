/**
 * @file Chips: a short word on a colored background (`ASK`, `OK`), and a node's
 *   chip in a color that is the same on every line and every run for the same
 *   id. In plain mode a chip is its word in brackets, so it still reads without
 *   color.
 */

import type { Term } from "./mode.ts";
import { apply, CHIP, NODE_PALETTE, type Role } from "./theme.ts";

/** The chip words the kit's commands use. */
export const CHIP_LABELS = {
  ask: "ASK",
  run: "RUN",
  ok: "OK",
  fail: "FAIL",
  wait: "WAIT",
  warn: "WARN",
  skip: "SKIP",
  error: "ERROR",
} as const;

/** A run's or trigger's state word as a chip: its label and role. */
export const statusChip = (status: string): { label: string; role: Role } => {
  const role: Role =
    status === "running"
      ? "accent"
      : status === "succeeded"
        ? "ok"
        : status === "failed" || status === "crashed"
          ? "danger"
          : [
                "paused",
                "budget_exhausted",
                "quota_exhausted",
                "timed_out",
                "interrupted",
              ].includes(status)
            ? "warn"
            : "muted";
  const label =
    status === "running"
      ? CHIP_LABELS.run
      : status === "succeeded"
        ? CHIP_LABELS.ok
        : status === "failed"
          ? CHIP_LABELS.fail
          : status.replaceAll("_", " ").toUpperCase();
  return { label, role };
};

/** A chip: ` LABEL ` on the role's background; `[LABEL]` when plain. */
export const chip = (term: Term, label: string, role: Role): string =>
  term.rich ? apply(term, CHIP[role], ` ${label} `) : `[${label}]`;

/** A stable non-negative number for `text` (FNV-1a). */
const hash = (text: string): number => {
  let h = 0x81_1c_9d_c5;
  for (const char of text) {
    h = Math.imul(h ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  }
  return h >>> 0;
};

/** The palette slot of a node id, 0 to 5, the same on every call. */
export const nodeSlot = (id: string): number => hash(id) % NODE_PALETTE.length;

/** A node's chip: its id on the color its id picks; `[id]` when plain. */
export const nodeChip = (term: Term, id: string): string => {
  const format = NODE_PALETTE[nodeSlot(id)] ?? CHIP.muted;
  return term.rich ? apply(term, format, ` ${id} `) : `[${id}]`;
};
