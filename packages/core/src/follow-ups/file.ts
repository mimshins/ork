/**
 * @file The `file` follow-up store: each new follow-up appended to a markdown
 *   file in the run's worktree (`.ork/follow-ups.md` by default), committed
 *   with the change, so public in a public repository. Ork's store keeps it
 *   too, to list and close it.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { DEFAULT_FOLLOW_UPS_FILE } from "@krapht/ork-schema";

import { followUpMarkdown } from "./markdown.ts";
import type { FollowUpPlaceAdapter } from "./types.ts";

const HEADER =
  "# Follow-ups\n\nWork changes left for later, added by Ork (`followUps.store: file`).\n";

/** The file's path relative to the worktree; throws when it leaves it. */
export const followUpsFile = (worktree: string, file?: string): string => {
  const target = path.resolve(worktree, file ?? DEFAULT_FOLLOW_UPS_FILE);
  const relative = path.relative(worktree, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`followUps.file ${file ?? ""} is outside the project.`);
  }
  return relative;
};

export const fileFollowUps: FollowUpPlaceAdapter = {
  place: "file",
  keep: (f, context) => {
    const relative = followUpsFile(context.worktree, context.rule.file);
    const target = path.join(context.worktree, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    if (!existsSync(target)) appendFileSync(target, HEADER);
    appendFileSync(target, `\n## ${f.title}\n\n${followUpMarkdown(f)}\n`);
    return Promise.resolve({ place: "file", url: relative });
  },
};
