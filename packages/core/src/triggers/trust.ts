/**
 * @file What a person accepts (RFC-011): a trigger, the workflow it starts,
 *   what its check runs beyond its own words, and the folder it was accepted
 *   in. A branch can change any of them and so what runs here with nobody
 *   there, so a change to one turns the trigger off until someone accepts it
 *   again. It can't cover all a run reads: skills, agents, scripts and called
 *   workflows aren't in it.
 */

import { createHash } from "node:crypto";

import type { Trigger } from "@krapht/ork-schema";

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => sorted(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sorted(item)]),
  );
};

const sha256 = () => createHash("sha256");

/** The hash of a workflow's text, which a run checks before it starts. */
export const workflowTextHash = (text: string): string =>
  sha256().update(text).digest("hex");

/**
 * The hash of a trigger, the text of the workflow it starts, the project's
 * folder (so another repository doesn't inherit it), and what the check reads.
 */
export const triggerHash = (
  trigger: Trigger,
  workflowText: string | undefined,
  root = "",
  reads: readonly string[] = [],
): string => {
  const hash = sha256()
    .update(JSON.stringify(sorted(trigger)))
    .update("\0")
    .update(workflowText ?? "")
    .update("\0")
    .update(root);
  for (const text of reads) hash.update("\0").update(text);
  return hash.digest("hex");
};
