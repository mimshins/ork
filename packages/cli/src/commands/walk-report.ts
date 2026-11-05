/**
 * @file How `ork validate` shows a walk (RFC-009): one line on what it tried,
 *   and with `--paths`, each way a run can end. A gate's answer that ends the
 *   run shows here as an ending, not as a problem.
 */

import {
  walkSummary,
  type WalkEnding,
  type WalkResult,
} from "@krapht/ork-core";

import { plain, style } from "../output.ts";

export const walkLine = (walk: WalkResult | undefined): string[] =>
  walk === undefined ? [] : [style("dim", walkSummary(walk))];

const endingLine = ({ status, notRun, paths }: WalkEnding): string => {
  const ways = `${String(paths)} ${paths === 1 ? "way" : "ways"}`;
  const word =
    status === "succeeded" ? style("green", status) : style("red", status);
  const rest =
    notRun.length === 0
      ? "every node ran"
      : `didn't run: ${notRun.map(id => plain(id)).join(", ")}`;
  return `  ${word} ${style("dim", `(${ways})`)} ${rest}`;
};

const endingLines = (ending: WalkEnding): string[] => [
  endingLine(ending),
  ...ending.choices.map(choice => style("dim", `      ${plain(choice)}`)),
];

/** Each ending, the ones that succeeded first, with one way to get there. */
export const pathLines = (walk: WalkResult | undefined): string[] => {
  const endings = walk?.endings ?? [];
  return [
    ...endings.filter(({ status }) => status === "succeeded"),
    ...endings.filter(({ status }) => status !== "succeeded"),
  ].flatMap(ending => endingLines(ending));
};
