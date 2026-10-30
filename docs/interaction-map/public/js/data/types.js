/**
 * @file The shapes every map's data uses, the card size, and the doc-link
 *   helper. Each map lives in its own folder (`architecture/`, `lifecycle/`, …)
 *   with `nodes.js`, `edges.js` and `journeys.js`, and is listed in `maps.js`.
 *   Text fields accept `code` in backticks; everything else is plain text.
 */

/**
 * A link to a file or directory in the Ork repository (see `sources.js`).
 *
 * @typedef {object} DocRef
 * @property {"ork"} repo The repository.
 * @property {string} path The repo-relative path (a directory links to its
 *   tree).
 * @property {string} label What the reader finds there.
 */

/**
 * Where a component stands today.
 *
 * - `built`: in the code on `main` today, with tests.
 * - `partial`: a minimum is built; the rest of its spec is not.
 * - `specified`: specified, not built.
 * - `planned`: designed for a later increment.
 * - `external`: someone else's: a person, a CLI, an API, the filesystem.
 *
 * @typedef {"built" | "partial" | "specified" | "planned" | "external"} Status
 */

/**
 * A zone's colour. Nodes take the colour of their zone.
 *
 * @typedef {"violet" | "blue" | "teal" | "orange" | "amber" | "slate"} Tone
 */

/**
 * A column of the map.
 *
 * @typedef {object} Zone
 * @property {string} id A unique id within the map; nodes name it in `zone`.
 * @property {string} label The heading at its top.
 * @property {number} x Left edge, in map units.
 * @property {number} w Width, in map units.
 * @property {Tone} tone Its colour.
 */

/**
 * An outlined box around components that run together.
 *
 * @typedef {object} Group
 * @property {string} id A unique id within the map.
 * @property {string} label The label above its top-left corner.
 * @property {number} x Left edge, in map units.
 * @property {number} y Top edge, in map units.
 * @property {number} w Width, in map units.
 * @property {number} h Height, in map units.
 */

/**
 * An address a component answers on: a URL (shown as a link) or a host, path or
 * name (shown as code).
 *
 * @typedef {object} HostRef
 * @property {string} url `https://…` for a link; anything else is shown as is.
 * @property {string} label What it is.
 */

/**
 * A link to a component or a journey on another map.
 *
 * @typedef {object} MapLink
 * @property {string} map The other map's id.
 * @property {string} [node] A node on that map.
 * @property {string} [journey] A journey on that map.
 * @property {string} label What the reader finds there.
 */

/**
 * An Ork workspace package (`packages/<name>`, named `@krapht/ork-<name>`; the
 * CLI is `@krapht/ork`).
 *
 * @typedef {"schema"
 *   | "core"
 *   | "runtime-claude"
 *   | "nodes"
 *   | "server"
 *   | "cli"
 *   | "ui"} Package
 */

/**
 * @typedef {object} MapNode
 * @property {string} id A unique id within the map, used in edges, journeys,
 *   and the URL.
 * @property {string} title The name on the card.
 * @property {string} sub One short line under the name.
 * @property {string} zone The id of the column it sits in.
 * @property {number} x Left edge, in map units.
 * @property {number} y Top edge, in map units.
 * @property {number} [w] Width (default {@link NODE_W}).
 * @property {Status} status Where it stands today.
 * @property {Package | null} pkg The Ork package its code lives in, or `null`
 *   for people, outside tools and services, and files.
 * @property {string} [src] The repo-relative directory or file its code lives
 *   (or will live) in. While the card is not `built`, the check lists it for
 *   review once this path exists.
 * @property {string} summary Two or three sentences: what it is and why it
 *   exists.
 * @property {string[]} facts What it holds, owns, and guarantees.
 * @property {HostRef[]} [hosts] The addresses it answers on.
 * @property {MapLink[]} [see] The same thing on other maps.
 * @property {DocRef[]} docs Where to read more.
 */

/**
 * How two components talk.
 *
 * - `net`: HTTP or SSE on localhost, or a request to a network API.
 * - `local`: a function call inside one process.
 * - `message`: an Ork bus message between node sessions.
 * - `process`: spawning a child process and talking over its stdio.
 * - `mcp`: an MCP tool call from a Claude session to Ork's tools.
 * - `file`: reading or writing files on disk.
 * - `human`: a person using the CLI or the UI.
 * - `event`: run events appended to the event store and streamed out.
 * - `git`: git commands: worktrees, branches, merges.
 *
 * @typedef {"net"
 *   | "local"
 *   | "message"
 *   | "process"
 *   | "mcp"
 *   | "file"
 *   | "human"
 *   | "event"
 *   | "git"} EdgeKind
 */

/**
 * @typedef {object} MapEdge
 * @property {string} id A unique id within the map.
 * @property {string} from The calling (or sending) node's id.
 * @property {string} to The called (or receiving) node's id.
 * @property {EdgeKind} kind How they talk.
 * @property {string} label A few words: what passes.
 * @property {string} detail What happens, in a sentence or three.
 * @property {Status} [status] Defaults to `built`.
 * @property {boolean} [both] Draw arrowheads at both ends.
 * @property {[number, number][]} [via] Corner points, in map units.
 * @property {DocRef[]} [docs] Where to read more.
 */

/**
 * A step goes from one node to another (drawn along their edge when one exists,
 * otherwise as its own arrow) or happens at one node (`to` left out).
 *
 * @typedef {object} JourneyStep
 * @property {string} from The node where the step starts (or happens).
 * @property {string} [to] The node it reaches; leave out for a step inside
 *   `from`.
 * @property {string} title A short line: what happens.
 * @property {string} detail What happens and why, in a few sentences.
 * @property {"planned" | "specified" | "partial"} [status] When the step is not
 *   (fully) built yet.
 * @property {DocRef[]} [docs] Where to read more.
 */

/**
 * @typedef {object} Journey
 * @property {string} id A unique id within the map, used in the URL.
 * @property {string} title The name in the journey picker.
 * @property {string} who Whose journey it is.
 * @property {string} summary One or two sentences.
 * @property {JourneyStep[]} steps The steps, in order.
 */

/**
 * One map: its own columns, components, connections and journeys.
 *
 * @typedef {object} MapData
 * @property {string} id A unique id, used in the URL (`#<id>/node/<node>`).
 * @property {string} title Its name in the map switcher.
 * @property {string} sub One line: what it shows.
 * @property {{ w: number; h: number }} size Its extent, in map units.
 * @property {ReadonlyArray<Zone>} zones The columns, left to right.
 * @property {ReadonlyArray<Group>} groups Outlined boxes.
 * @property {ReadonlyArray<MapNode>} nodes Components.
 * @property {ReadonlyArray<MapEdge>} edges Connections.
 * @property {ReadonlyArray<Journey>} journeys Step-by-step walks.
 */

/** The default card size, in map units. */
export const NODE_W = 220;
export const NODE_H = 72;

/**
 * A doc link into the Ork repository.
 *
 * @param {string} path The repo-relative path.
 * @param {string} label What the reader finds there.
 * @returns {DocRef} The link.
 */
export const d = (path, label) => ({ repo: "ork", path, label });
