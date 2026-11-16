/**
 * @file The bounded git digest in the `ork onboard` survey: the last commit
 *   subjects, the newest release tags and the most-changed paths, read with
 *   three `git` calls and no model. No author, email or hash is kept; every
 *   line goes through the shared secret scrubber (ADR-091) before it can reach
 *   the proposing session (specs/cli/onboard-flow.md#the-survey).
 */

import { maskSecrets } from "@krapht/ork-core";

import { capped, oneLine } from "./text.ts";

const MAX_SUBJECTS = 20;
const MAX_TAGS = 10;
const MAX_PATHS = 10;
const LOG_WINDOW = 200;

export type GitDigest = {
  /**
   * Subjects of the newest commits, newest first; at most 20, 100 characters
   * each.
   */
  subjects: string[];
  /** Release tags, newest first; at most 10, 60 characters each. */
  tags: string[];
  /**
   * The paths touched most in the last 200 commits; at most 10, 100 characters
   * each.
   */
  paths: string[];
};

type Git = (args: readonly string[]) => Promise<string | null>;

/** Masks secrets first, then makes the text one capped line. */
const clean = (text: string, max: number): string =>
  oneLine(maskSecrets(text), max);

const linesOf = (text: string | null): string[] =>
  (text ?? "").split("\n").filter(line => line.trim() !== "");

/** Paths by how often they changed, most first; ties by name. */
const mostChanged = (names: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
};

/** The digest of the repository, or `null` when `git log` fails. */
export const readGitDigest = async (git: Git): Promise<GitDigest | null> => {
  const [subjects, tags, names] = await Promise.all([
    git(["log", "-n", String(MAX_SUBJECTS), "--format=%s"]),
    git(["tag", "--sort=-creatordate"]),
    git(["log", "-n", String(LOG_WINDOW), "--name-only", "--format="]),
  ]);
  if (subjects === null) return null;
  return {
    subjects: linesOf(subjects)
      .slice(0, MAX_SUBJECTS)
      .map(s => clean(s, 100)),
    tags: capped(linesOf(tags), MAX_TAGS).shown.map(t => clean(t, 60)),
    paths: capped(mostChanged(linesOf(names)), MAX_PATHS).shown.map(p =>
      clean(p, 100),
    ),
  };
};

const listOf = (items: readonly string[], joiner: string): string =>
  items.length === 0 ? "none" : items.join(joiner);

/** The digest as one survey line. */
export const digestLine = (digest: GitDigest | null): string =>
  digest === null
    ? "Recent history: unavailable"
    : `Recent history: commits: ${listOf(digest.subjects, " | ")}; tags: ${listOf(digest.tags, ", ")}; most-changed paths: ${listOf(digest.paths, ", ")}`;
