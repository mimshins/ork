/**
 * @file How one `ork doctor` check reads on the terminal: a chip for ok, warn,
 *   fail or skip, its details wrapped under their column and its hint dimmed
 *   and indented; plain, the mark and lines `ork doctor` always printed.
 */

import type { CheckResult } from "@krapht/ork-integrations";

import { style } from "../output.ts";
import { CHIP_LABELS, chip } from "../term/chips.ts";
import { hang, wrap } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";
import { paint, type Role } from "../term/theme.ts";

/** Marks are made when used, so `--plain` (set after load) is read. */
const MARK: Record<CheckResult["status"], () => string> = {
  ok: () => style("green", "✓"),
  warn: () => style("yellow", "!"),
  fail: () => style("red", "✗"),
  skip: () => style("dim", "-"),
};

const CHECK_CHIP: Record<CheckResult["status"], { label: string; role: Role }> =
  {
    ok: { label: CHIP_LABELS.ok, role: "ok" },
    warn: { label: CHIP_LABELS.warn, role: "warn" },
    fail: { label: CHIP_LABELS.fail, role: "danger" },
    skip: { label: CHIP_LABELS.skip, role: "muted" },
  };

/**
 * A check's lines. Rich: a chip (its words padded to line the details up), the
 * detail wrapped under its column, the hint dimmed and indented; plain: a mark
 * and the lines as they always were.
 */
export const formatCheck = (
  result: CheckResult,
  term: Term = termOf(process.stdout),
): string[] => {
  if (!term.rich) {
    const line = `${MARK[result.status]()} ${result.name.padEnd(20)} ${result.detail}`;
    return result.hint === undefined
      ? [line]
      : [line, `  ${style("dim", result.hint)}`];
  }
  const { label, role } = CHECK_CHIP[result.status];
  const lead = `${chip(term, label.padEnd(4), role)} ${result.name.padEnd(20)} `;
  return [
    ...hang(lead, result.detail, term.width),
    ...(result.hint === undefined
      ? []
      : wrap(result.hint, term.width - 2).map(
          line => `  ${paint(term, "muted", line)}`,
        )),
  ];
};
