/**
 * @file The repository the map is drawn from, and the commit it was last synced
 *   to. `tools/check.mjs` checks every doc link against the working tree and
 *   lists the commits since `synced`.
 */

/**
 * @typedef {object} Source
 * @property {string} name The repository's name.
 * @property {string} short The short label shown on doc links.
 * @property {string} github The repository's GitHub URL.
 * @property {string} branch The branch doc links point at.
 * @property {string} synced The commit the map last matched (short hash).
 * @property {boolean} isPublic Whether the repository is world-readable.
 */

/** @type {Readonly<Record<"ork", Source>>} */
export const SOURCES = {
  ork: {
    name: "ork",
    short: "ork",
    github: "https://github.com/mimshins/ork",
    branch: "main",
    synced: "122e306",
    isPublic: true,
  },
};

/** The day the map was last synced with the repository. */
export const SYNCED_ON = "2026-10-30";
