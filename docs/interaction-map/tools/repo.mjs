/**
 * @file What the map and roadmap checks share: the repository root, a git
 *   runner that never throws, and checking a doc link against the files and
 *   their Markdown headings.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Runs git in the repository.
 *
 * @param {string[]} args The git arguments.
 * @returns {string} Its output, or `""` when it failed.
 */
export const git = args => {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

/**
 * GitHub's anchor for a Markdown heading.
 *
 * @param {string} heading The heading text, without the `#` marks.
 * @returns {string} The anchor.
 */
const slug = heading =>
  heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .replaceAll(/\s/gu, "-");

/** @type {Map<string, Set<string>>} */
const anchorCache = new Map();

/**
 * The anchors of a Markdown file's headings.
 *
 * @param {string} path The repo-relative path.
 * @returns {Set<string>} The anchors.
 */
const anchorsOf = path => {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const text = readFileSync(join(ROOT, path), "utf8");
  const anchors = new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gmu)].map(m => slug(m[1] ?? "")),
  );
  anchorCache.set(path, anchors);
  return anchors;
};

/**
 * What is wrong with a repo-relative link, optionally with `#anchor`.
 *
 * @param {string} link The path.
 * @returns {string | null} The problem, or `null`.
 */
export const linkProblem = link => {
  const [path = "", anchor] = link.split("#");
  if (!existsSync(join(ROOT, path))) return `${path} does not exist`;
  if (anchor !== undefined && !anchorsOf(path).has(anchor)) {
    return `${path} has no heading #${anchor}`;
  }
  return null;
};
