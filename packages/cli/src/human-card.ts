/**
 * @file The card `ork decide` and a run's questions show: an ASK chip, the
 *   node's chip, where the question sits, the question bold and wrapped, and
 *   its context dimmed and indented (cut to a few lines until `d` or
 *   `--verbose`). Plain, the card is today's `? node asks: question` lines.
 *   Text from agents goes through `plain()` before it is styled.
 */

import type { HumanQuestion } from "@krapht/ork-core";

import { plain } from "./output.ts";
import { chip, CHIP_LABELS, nodeChip } from "./term/chips.ts";
import { cut, wrap } from "./term/layout.ts";
import type { Term } from "./term/mode.ts";
import { bold, paint } from "./term/theme.ts";

/** Where a question sits in `ork decide`: its run, and "n of m". */
export type AskPlace = {
  run: string;
  decision: string;
  index: number;
  total: number;
};

/** Lines of context a card shows before `d` (or `--verbose`) shows the rest. */
const CONTEXT_LINES = 6;

/** Text from outside with its escapes gone and its line breaks kept. */
export const clean = (text: string): string =>
  text
    .split("\n")
    .map(line => plain(line))
    .join("\n");

/** The card above the options, in the rich look or the plain lines. */
export const cardLines = (
  t: Term,
  q: HumanQuestion,
  place: AskPlace | undefined,
  verbose: boolean,
  /** A short document plain mode prints before the question. */
  document?: string,
): { lines: string[]; moreContext: boolean } => {
  const context = q.context === undefined ? undefined : clean(q.context);
  if (!t.rich) {
    const lines = [
      ...(place === undefined
        ? []
        : [`run ${place.run} · decision ${place.decision}`]),
      ...(document === undefined ? [] : [document]),
      `? ${plain(q.nodeId)} asks: ${clean(q.question)}`,
      ...(context === undefined
        ? []
        : [`  ${context.replaceAll("\n", "\n  ")}`]),
    ];
    return { lines, moreContext: false };
  }
  const shown = context === undefined ? [] : wrap(context, t.width - 3);
  const cutShort = !verbose && shown.length > CONTEXT_LINES;
  const body = cutShort ? shown.slice(0, CONTEXT_LINES) : shown;
  const where =
    place === undefined
      ? ""
      : `  ${paint(t, "muted", `run ${place.run} · ${String(place.index)} of ${String(place.total)}`)}`;
  return {
    lines: [
      "",
      ` ${chip(t, CHIP_LABELS.ask, "accent")} ${nodeChip(t, plain(q.nodeId))}${where}`,
      ...wrap(clean(q.question), t.width - 1).map(l => ` ${bold(t, l)}`),
      ...body.map(l => paint(t, "muted", `   ${l}`)),
      ...(cutShort
        ? [
            paint(
              t,
              "muted",
              `   … ${String(shown.length - CONTEXT_LINES)} more lines (d)`,
            ),
          ]
        : []),
    ],
    moreContext: cutShort,
  };
};

/** The line above a permission prompt: who wants to run what. */
export const permitLine = (
  t: Term,
  nodeId: string,
  preview: string,
): string => {
  const node = plain(nodeId);
  const what = plain(preview);
  if (!t.rich) return `? ${node} wants to run ${what}`;
  // The chips and words before the preview take 12 columns and the node's id.
  const room = Math.max(20, t.width - node.length - 24);
  return ` ${chip(t, CHIP_LABELS.ask, "accent")} ${nodeChip(t, node)} wants to run ${cut(what, room)}`;
};

/**
 * The line a card collapses to once answered: `✓ 509da722-1 · add-invalid-node`
 * (the decision, or the node when there is none, and the choice), or a note
 * that it was left for later.
 */
export const doneLine = (
  t: Term,
  place: AskPlace | undefined,
  nodeId: string,
  answer: { kind: "later" } | { kind: "chosen"; id: string; note?: string },
): string => {
  const who = place?.decision ?? plain(nodeId);
  if (answer.kind === "later") {
    return ` ${paint(t, "muted", "·")} ${cut(`${who} left for later`, t.width - 3)}`;
  }
  const said =
    answer.note === undefined ? "" : ` · said: ${plain(answer.note)}`;
  return ` ${paint(t, "ok", "✓")} ${cut(`${who} · ${answer.id}${said}`, t.width - 3)}`;
};
