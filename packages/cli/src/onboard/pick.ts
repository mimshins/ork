/**
 * @file What `ork onboard` does with the proposer's answer: reads the `propose`
 *   node's `suggestions` out of the run and checks them against the project in
 *   this process (`filterSuggestions`; no tool node, so a long list never meets
 *   an argument or environment limit), shows the surviving suggestions and the
 *   ones dropped with why, and takes the picks with a `multiselect`
 *   (specs/cli/onboard-flow.md#proposing-and-picking). Everything shown came
 *   from a model reading untrusted files, so it is stripped of escape sequences
 *   first.
 */

import type { RunResult } from "@krapht/ork-core";

import { plain, shortCount, style } from "../output.ts";
import type { PromptIO } from "../term/mode.ts";
import { multiselect } from "../term/multiselect.ts";
import type { Suggestion } from "./suggestion.ts";
import { type Dropped, filterSuggestions } from "./verbs-filter.ts";

export type Proposed = { kept: Suggestion[]; dropped: Dropped[] };

/** The `propose` node's `suggestions`; a missing or non-list value is empty. */
const suggestionsOf = (result: RunResult): readonly unknown[] => {
  const value = result.nodes.find(n => n.id === "propose")?.output?.[
    "suggestions"
  ];
  return Array.isArray(value) ? value : [];
};

/** The survivors and the drops of a propose run, checked against `root`. */
export const proposedOf = (result: RunResult, root: string): Proposed =>
  filterSuggestions(suggestionsOf(result), root);

const evidenceOf = (e: Suggestion["evidence"][number]): string =>
  "path" in e ? e.path : `commit ${e.commit.slice(0, 12)}`;

/** One suggestion, as lines: the workflow, why, who decides, caps, evidence. */
export const suggestionLines = (s: Suggestion, number: number): string[] => [
  `${String(number)}. ${style("bold", plain(s.workflow))}`,
  `   why:      ${plain(s.why)}`,
  `   a person decides: ${plain(s.decidedBy)}`,
  `   caps:     $${String(s.caps.budgetUsd)} · ${shortCount(s.caps.budgetTokens)} tokens`,
  `   evidence: ${s.evidence.map(e => plain(evidenceOf(e))).join(", ")}`,
];

export const dropLines = ({ workflow, reasons }: Dropped): string[] => [
  style(
    "dim",
    `   dropped ${plain(workflow ?? "an entry")}: ${plain(reasons.join("; "))}`,
  ),
];

/** The picks, in the order shown; `null` when the person pressed Ctrl-C. */
export const pickSuggestions = async (
  io: PromptIO,
  proposed: Proposed,
  out: (line: string) => void,
): Promise<Suggestion[] | null> => {
  proposed.kept.forEach((s, i) => {
    for (const line of suggestionLines(s, i + 1)) out(line);
  });
  for (const drop of proposed.dropped) {
    for (const line of dropLines(drop)) out(line);
  }
  if (proposed.kept.length === 0) return [];
  const answer = await multiselect(io, {
    header: () => ["Which workflows should Ork write?"],
    options: proposed.kept.map(s => ({
      id: s.workflow,
      description: plain(s.why),
    })),
    later: true,
  });
  if (answer.kind === "interrupted") return null;
  const ids = new Set(answer.kind === "chosen" ? answer.ids : []);
  return proposed.kept.filter(s => ids.has(s.workflow));
};
