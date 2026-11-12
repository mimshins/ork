/**
 * @file The note `ork run` prints at the start for a `branch:` lock that has no
 *   origin to key by (RFC-016): the lock is local to the folder, so no other
 *   clone shares it. Only a `branch:` lock gets one.
 */

import path from "node:path";

import { lockIsLocal, parseTemplate, renderTemplate } from "@krapht/ork-core";
import type { Workflow } from "@krapht/ork-schema";

/**
 * The notes, one per distinct `branch:` lock the run names that is local to
 * `repo`.
 */
export const localLockNotes = async (
  workflow: Workflow,
  inputs: Record<string, unknown>,
  repo: string,
): Promise<string[]> => {
  const names = new Set<string>();
  for (const node of Object.values(workflow.nodes)) {
    const lock = "lock" in node ? node.lock : undefined;
    if (lock === undefined) continue;
    const parsed = parseTemplate(lock);
    // A name that does not render is `ork validate`'s to refuse, not a note.
    if (parsed.ok) {
      names.add(renderTemplate(parsed.parts, { inputs, nodes: {} }));
    }
  }
  const local = await Promise.all(
    [...names].map(async name =>
      (await lockIsLocal(name, { repo })) ? name : undefined,
    ),
  );
  return local
    .filter(name => name !== undefined)
    .map(
      name =>
        `${name} is local to ${path.resolve(repo)}: no origin, so no other clone shares it`,
    );
};
