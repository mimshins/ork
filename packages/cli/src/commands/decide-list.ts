/** @file The list `ork decide --list` prints: one line per open decision. */

import type { DecisionRecord } from "@krapht/ork-core";

import { plain } from "../output.ts";
import { chip, CHIP_LABELS, nodeChip } from "../term/chips.ts";
import { cut } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";
import { bold } from "../term/theme.ts";

/**
 * One line per open decision, for `--list`: on a terminal an ASK chip and the
 * node's chip with the id and the question after, cut to the screen; plain, the
 * id, the node and the question.
 */
export const formatDecisions = (
  decisions: readonly DecisionRecord[],
  workflow?: string,
  t: Term = termOf(process.stdout),
): string[] => {
  if (decisions.length === 0) {
    return [
      workflow === undefined
        ? "No open decisions."
        : `No open decisions in workflow ${workflow}.`,
    ];
  }
  const idWidth = Math.max(...decisions.map(d => d.id.length));
  const nodeWidth = Math.max(...decisions.map(d => plain(d.node).length));
  return decisions.map(d => {
    const node = plain(d.node);
    const options = `[${d.options.map(o => (o.id === d.recommended ? `${o.id}*` : o.id)).join(", ")}]`;
    const document = d.document === undefined ? "" : " +document";
    const via = d.owner === undefined ? "" : ` via ${plain(d.owner)}`;
    if (!t.rich) {
      return `${d.id}  ${node}${via}  ${plain(d.question)}${document} ${options}`;
    }
    const lead = `${chip(t, CHIP_LABELS.ask, "accent")} ${nodeChip(t, node)}${" ".repeat(nodeWidth - node.length)} ${bold(t, d.id.padEnd(idWidth))}  `;
    // The lead is `ASK  node  id  ` wide; the question gets the rest.
    const room = Math.max(20, t.width - (7 + nodeWidth + 2 + idWidth + 2));
    const tail = cut(`${plain(d.question)}${document} ${options}${via}`, room);
    return `${lead}${tail}`;
  });
};
