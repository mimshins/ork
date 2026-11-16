/**
 * @file The check `ork onboard` runs in-process on what the proposer suggested,
 *   against the project (G21: the driver may not hold the shape). An entry is
 *   dropped, with every reason, when it is malformed, cites a file or commit
 *   that is not there, drafts a command whose program or package script does
 *   not exist, or repeats a workflow or is past the tenth. It runs nothing the
 *   model drafted (specs/cli/onboard-verbs.md#the-filter).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

import { type Suggestion, SuggestionSchema } from "./suggestion.ts";
import { insideRoot } from "./survey-files.ts";
import { commandReasons, packageScripts } from "./verbs-commands.ts";

/** The most suggestions kept. */
export const MAX_KEPT = 10;

export type Dropped = {
  index: number;
  workflow: string | null;
  reasons: string[];
};

export type Filtered = { kept: Suggestion[]; dropped: Dropped[] };

const COMMIT = /^[0-9a-f]{7,40}$/iu;

const commitExists = (commit: string, root: string): boolean => {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const evidenceReasons = (
  item: Suggestion["evidence"][number],
  root: string,
): string[] => {
  if ("commit" in item) {
    if (!COMMIT.test(item.commit)) {
      return [
        `evidence commit \`${item.commit}\` is not 7 to 40 hex characters`,
      ];
    }
    return commitExists(item.commit, root)
      ? []
      : [`evidence commit ${item.commit} is not in this repository`];
  }
  const climbs = path.normalize(item.path).startsWith("..");
  if (path.isAbsolute(item.path) || climbs) {
    return [
      `evidence path \`${item.path}\` is absolute or outside the project`,
    ];
  }
  return insideRoot(root, item.path) === null
    ? [`evidence path \`${item.path}\` does not exist in the project`]
    : [];
};

const nameOf = (entry: unknown): string | null =>
  typeof entry === "object" &&
  entry !== null &&
  "workflow" in entry &&
  typeof entry.workflow === "string"
    ? entry.workflow
    : null;

/** Checks the proposer's list (parsed JSON) against the project at `root`. */
export const filterSuggestions = (
  entries: readonly unknown[],
  root: string,
): Filtered => {
  const kept: Suggestion[] = [];
  const dropped: Dropped[] = [];
  const scripts = packageScripts(root);
  for (const [index, entry] of entries.entries()) {
    const parsed = SuggestionSchema.safeParse(entry);
    if (!parsed.success) {
      dropped.push({
        index,
        workflow: nameOf(entry),
        reasons: parsed.error.issues.map(
          issue => `${issue.path.join(".") || "entry"}: ${issue.message}`,
        ),
      });
      continue;
    }
    const suggestion = parsed.data;
    const reasons = [
      ...suggestion.evidence.flatMap(item => evidenceReasons(item, root)),
      ...(suggestion.commands ?? []).flatMap(line =>
        commandReasons(line, root, scripts),
      ),
      ...(kept.some(({ workflow }) => workflow === suggestion.workflow)
        ? [`workflow \`${suggestion.workflow}\` is suggested twice`]
        : []),
      ...(kept.length >= MAX_KEPT
        ? [`already ${String(MAX_KEPT)} suggestions kept`]
        : []),
    ];
    if (reasons.length === 0) kept.push(suggestion);
    else dropped.push({ index, workflow: suggestion.workflow, reasons });
  }
  return { kept, dropped };
};
