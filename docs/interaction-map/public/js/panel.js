/**
 * @file The side panel: everything about one component or one connection, with
 *   its links into the repositories.
 */

import { SOURCES } from "./data/sources.js";
import { docUrl } from "./lib/docs.js";
import { esc, rich } from "./lib/dom.js";
import { mapById, nodeOf, toneOf } from "./model.js";

/** @typedef {import("./data/types.js").MapData} MapData */
/** @typedef {import("./data/types.js").DocRef} DocRef */
/** @typedef {import("./data/types.js").HostRef} HostRef */
/** @typedef {import("./data/types.js").MapLink} MapLink */
/** @typedef {import("./data/types.js").Status} Status */
/** @typedef {import("./data/types.js").EdgeKind} EdgeKind */

/** What each status means, as shown in pills and the legend. */
export const STATUS_LABEL = /** @type {const} */ ({
  built: "Built",
  partial: "Partly built",
  specified: "Specified",
  planned: "Planned",
  external: "External",
});

/** What each edge kind means. */
export const KIND_LABEL = /** @type {const} */ ({
  net: "HTTP, SSE or a network API",
  local: "In-process call",
  message: "Ork message (bus)",
  process: "Spawns a process",
  mcp: "MCP tool call",
  file: "Reads or writes files",
  human: "A person acts",
  event: "Run events",
  git: "Git and worktrees",
});

/** @param {MapData} m @param {string} id */
const zoneLabel = (m, id) => m.zones.find(z => z.id === id)?.label ?? id;

/** @param {Status} s */
const statusPill = s =>
  `<span class="pill status-${s}"><i></i>${STATUS_LABEL[s]}</span>`;

/** @param {DocRef[]} docs */
const docList = docs =>
  docs.length === 0
    ? ""
    : `<section><h3>Read more</h3><ul class="docs">${docs
        .map(ref => {
          const src = SOURCES[ref.repo];
          return `<li><a href="${esc(docUrl(ref))}" target="_blank" rel="noopener noreferrer">
            <span class="repo repo-${ref.repo}">${esc(src.short)}${src.isPublic ? "" : '<svg class="lock" viewBox="0 0 12 12" aria-label="private"><path d="M3.5 5V3.8a2.5 2.5 0 0 1 5 0V5M2.5 5h7v5h-7z"/></svg>'}</span>
            <span class="doc-label">${rich(ref.label)}</span>
            <span class="doc-path">${esc(ref.path)}</span></a></li>`;
        })
        .join("")}</ul></section>`;

/** @param {HostRef[]} hosts */
const hostList = hosts =>
  hosts.length === 0
    ? ""
    : `<section><h3>Addresses</h3><ul class="hosts">${hosts
        .map(
          h =>
            `<li>${
              h.url.startsWith("https://")
                ? `<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer"><code>${esc(h.url.replace(/^https:\/\//, ""))}</code></a>`
                : `<code>${esc(h.url)}</code>`
            }<span>${rich(h.label)}</span></li>`,
        )
        .join("")}</ul></section>`;

/** @param {MapLink[]} links */
const seeList = links => {
  const rows = links.flatMap(l => {
    const other = mapById(l.map);
    if (!other) return [];
    const target = l.node
      ? nodeOf(other, l.node)?.title
      : l.journey
        ? other.journeys.find(j => j.id === l.journey)?.title
        : undefined;
    return [
      `<li><button class="see" data-map="${esc(l.map)}"${l.node ? ` data-node="${esc(l.node)}"` : ""}${
        l.journey ? ` data-journey="${esc(l.journey)}"` : ""
      }><span class="see-map">${esc(other.title)}${target ? ` · ${esc(target)}` : ""}</span><span class="see-label">${rich(l.label)}</span></button></li>`,
    ];
  });
  return rows.length === 0
    ? ""
    : `<section><h3>On other maps</h3><ul class="sees">${rows.join("")}</ul></section>`;
};

/**
 * The journeys a node or a pair of nodes appears in, with the step numbers.
 *
 * @param {MapData} m The map.
 * @param {(s: import("./data/types.js").JourneyStep) => boolean} match Which
 *   steps count.
 * @returns {string} The section's HTML, or "".
 */
const journeysWith = (m, match) => {
  const rows = m.journeys
    .map(j => ({ j, steps: j.steps.flatMap((s, i) => (match(s) ? [i] : [])) }))
    .filter(r => r.steps.length > 0);
  if (rows.length === 0) return "";
  return `<section><h3>In journeys</h3><div class="chips">${rows
    .map(
      ({ j, steps }) =>
        `<button class="chip-btn" data-journey="${j.id}" data-step="${steps[0]}">${esc(j.title)}<small>step${
          steps.length > 1 ? "s" : ""
        } ${steps.map(i => i + 1).join(", ")}</small></button>`,
    )
    .join("")}</div></section>`;
};

/**
 * The panel's HTML for one node.
 *
 * @param {MapData} m The map.
 * @param {string} id The node's id.
 * @returns {string} The HTML.
 */
export const nodeHtml = (m, id) => {
  const n = nodeOf(m, id);
  if (!n) return "";
  const out = m.edges.filter(e => e.from === id);
  const into = m.edges.filter(e => e.to === id);
  /** @param {import("./data/types.js").MapEdge} e @param {string} other */
  const row = (e, other) => {
    const o = nodeOf(m, other);
    return `<li><button class="conn kind-${e.kind}" data-edge="${e.id}">
      <span class="conn-kind" title="${KIND_LABEL[e.kind]}"></span>
      <span class="conn-node">${esc(o?.title ?? other)}</span>
      <span class="conn-label">${rich(e.label)}</span>
      ${e.status && e.status !== "built" ? `<span class="mini status-${e.status}">${STATUS_LABEL[e.status]}</span>` : ""}
    </button></li>`;
  };
  return `
    <header class="panel-head tone-${toneOf(m, n)}">
      <div class="eyebrow"><span class="zone-dot"></span>${esc(zoneLabel(m, n.zone))}${
        n.pkg
          ? ` · <code>${esc(n.pkg === "cli" ? "@krapht/ork" : `@krapht/ork-${n.pkg}`)}</code>`
          : ""
      }</div>
      <h2>${esc(n.title)}</h2>
      <p class="sub">${rich(n.sub)}</p>
      ${statusPill(n.status)}
    </header>
    <p class="summary">${rich(n.summary)}</p>
    ${n.facts.length ? `<section><h3>Holds and guarantees</h3><ul class="facts">${n.facts.map(f => `<li>${rich(f)}</li>`).join("")}</ul></section>` : ""}
    ${hostList(n.hosts ?? [])}
    ${out.length ? `<section><h3>Talks to</h3><ul class="conns">${out.map(e => row(e, e.to)).join("")}</ul></section>` : ""}
    ${into.length ? `<section><h3>Reached by</h3><ul class="conns">${into.map(e => row(e, e.from)).join("")}</ul></section>` : ""}
    ${journeysWith(m, s => s.from === id || s.to === id)}
    ${seeList(n.see ?? [])}
    ${docList(n.docs)}`;
};

/**
 * The panel's HTML for one edge.
 *
 * @param {MapData} m The map.
 * @param {string} id The edge's id.
 * @returns {string} The HTML.
 */
export const edgeHtml = (m, id) => {
  const e = m.edges.find(x => x.id === id);
  if (!e) return "";
  const from = nodeOf(m, e.from);
  const to = nodeOf(m, e.to);
  const status = e.status ?? "built";
  return `
    <header class="panel-head kind-${e.kind}">
      <div class="eyebrow"><span class="kind-line"></span>${KIND_LABEL[e.kind]}</div>
      <h2 class="edge-title">${rich(e.label)}</h2>
      <div class="route">
        <button class="node-link tone-${toneOf(m, from)}" data-node="${e.from}">${esc(from?.title ?? e.from)}</button>
        <span class="route-arrow" aria-hidden="true">${e.both ? "⇄" : "→"}</span>
        <button class="node-link tone-${toneOf(m, to)}" data-node="${e.to}">${esc(to?.title ?? e.to)}</button>
      </div>
      ${statusPill(status)}
    </header>
    <p class="summary">${rich(e.detail)}</p>
    ${journeysWith(m, s => (s.from === e.from && s.to === e.to) || (s.from === e.to && s.to === e.from))}
    ${docList(e.docs ?? [])}`;
};
