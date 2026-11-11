/**
 * @file The workflow-format part of `ork migrate` (RFC-015): finds the
 *   project's workflow files that name a renamed node type, plans their rewrite
 *   in the YAML itself (comments and layout kept), and writes it. A file that
 *   cannot be rewritten is named and left untouched.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { placeFiles, type ProjectPlace, shownPath } from "@krapht/ork-core";
import { renameNodeTypes } from "@krapht/ork-schema";

import { WORKFLOW_SUFFIX } from "../workflows.ts";

export type FormatChange = {
  file: string;
  /** The new text, with the file's comments and layout kept. */
  text: string;
  /** How many nodes of each old type it renames. */
  renamed: Record<string, number>;
};

export type FormatSkip = { file: string; reason: string };

export type FormatPlan = { changes: FormatChange[]; skipped: FormatSkip[] };

/** The project's workflow files (`*.ork.yaml` in its workflows folder). */
const workflowFiles = (place: ProjectPlace): string[] => {
  const dir = placeFiles(place).workflows;
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith(WORKFLOW_SUFFIX))
      .toSorted()
      .map(name => path.join(dir, name));
  } catch {
    // No workflows folder: nothing to rewrite.
    return [];
  }
};

/** Which workflow files name a renamed type, and what each becomes. */
export const planFormat = (place: ProjectPlace): FormatPlan => {
  const plan: FormatPlan = { changes: [], skipped: [] };
  for (const file of workflowFiles(place)) {
    const result = renameNodeTypes(readFileSync(file, "utf8"));
    if (result === null) continue;
    if (result.ok) {
      plan.changes.push({ file, text: result.text, renamed: result.renamed });
    } else {
      plan.skipped.push({ file, reason: result.reason });
    }
  }
  return plan;
};

/** One line per file: what changes, or why it is left as it is. */
export const formatFormatPlan = (
  plan: FormatPlan,
  place: ProjectPlace,
): string[] => [
  ...plan.changes.map(({ file, renamed }) => {
    const what = Object.entries(renamed)
      .map(([from, count]) => `${from} ×${String(count)}`)
      .join(", ");
    return `  rename ${shownPath(file, place.root)}: ${what}`;
  }),
  ...plan.skipped.map(
    ({ file, reason }) =>
      `  skip   ${shownPath(file, place.root)}: ${reason}; left as it is`,
  ),
];

/** Writes the rewritten files. */
export const applyFormat = (plan: FormatPlan): void => {
  for (const { file, text } of plan.changes) writeFileSync(file, text);
};
