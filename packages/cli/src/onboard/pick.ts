/**
 * @file What `ork onboard` does with the proposer's answer: reads the `filter`
 *   node's result out of the run, shows the surviving suggestions and the ones
 *   dropped with why, and takes the picks with a `multiselect`
 *   (specs/cli/onboard-flow.md#proposing-and-picking). Everything shown came
 *   from a model reading untrusted files, so it is stripped of escape sequences
 *   first.
 */

import type { RunResult } from "@krapht/ork-core";

import { plain, shortCount, style } from "../output.ts";
import type { PromptIO } from "../term/mode.ts";
import { multiselect } from "../term/multiselect.ts";
import { type Suggestion, SuggestionSchema } from "./suggestion.ts";
import type { Dropped } from "./verbs-filter.ts";

export type Proposed = { kept: Suggestion[]; dropped: Dropped[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

/** The filter node's result: `output.json`, else its stdout parsed. */
const filterJson = (result: RunResult): Record<string, unknown> => {
  const output = record(result.nodes.find(n => n.id === "filter")?.output);
  if ("json" in output) return record(output["json"]);
  try {
    const stdout = output["stdout"];
    return record(JSON.parse(typeof stdout === "string" ? stdout : ""));
  } catch {
    return {};
  }
};

/**
 * The survivors and the drops of a propose run; each survivor is parsed again,
 * so nothing the run's output holds is trusted for its shape.
 */
export const proposedOf = (result: RunResult): Proposed => {
  const json = filterJson(result);
  const kept = Array.isArray(json["kept"]) ? json["kept"] : [];
  const dropped = Array.isArray(json["dropped"]) ? json["dropped"] : [];
  return {
    kept: kept.flatMap(item => {
      const parsed = SuggestionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
    dropped: dropped.map((item, index) => {
      const d = record(item);
      const reasons = Array.isArray(d["reasons"]) ? d["reasons"] : [];
      return {
        index: typeof d["index"] === "number" ? d["index"] : index,
        workflow: typeof d["workflow"] === "string" ? d["workflow"] : null,
        reasons: reasons.map(String),
      };
    }),
  };
};

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
