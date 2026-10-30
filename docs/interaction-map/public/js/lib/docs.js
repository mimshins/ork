/** @file Links into the three repositories on GitHub. */

import { SOURCES } from "../data/sources.js";

/** @typedef {import("../data/types.js").DocRef} DocRef */

/**
 * Builds the GitHub URL of a doc: `blob/` for a file, `tree/` for a directory
 * (a path whose last segment has no dot).
 *
 * @param {DocRef} ref The doc.
 * @returns {string} The URL.
 */
export const docUrl = ref => {
  const src = SOURCES[ref.repo];
  const last = ref.path.split("/").pop() ?? "";
  const kind = last.includes(".") ? "blob" : "tree";
  return `${src.github}/${kind}/${src.branch}/${ref.path}`;
};

/**
 * The URL of the commit a repository was last synced to.
 *
 * @param {keyof typeof SOURCES} repo The repository.
 * @returns {string} The URL.
 */
export const commitUrl = repo =>
  `${SOURCES[repo].github}/commit/${SOURCES[repo].synced}`;
