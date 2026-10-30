/**
 * @file Checks the interaction map's data, and lists what changed in the
 *   repository since the last sync. Run it with `pnpm map:check`; `pnpm check`
 *   runs it too.
 *
 *   1. In every map: ids are unique; every edge and journey step names a node that
 *      exists; every card sits inside its zone and the map and overlaps no
 *      other card; every `via` route runs along one axis at a time; zone and
 *      group labels fit; every link to another map resolves.
 *   2. Every doc link points at a file or directory in the repository, and every
 *      `#anchor` matches a heading of that Markdown file.
 *   3. Statuses: a `built` card links to code under `packages/` (or an example)
 *      and its `src` exists. A card that is not built but whose `src` exists
 *      now is listed for review (not an error).
 *   4. The commits and uncommitted changes since `synced` in `sources.js`: the
 *      list to review when resyncing.
 *   5. The roadmap (`check-roadmap.mjs`), and the commits it does not name yet.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { MAPS } from "../public/js/data/maps.js";
import { SOURCES } from "../public/js/data/sources.js";
import { NODE_H, NODE_W } from "../public/js/data/types.js";
import { checkRoadmap } from "./check-roadmap.mjs";
import { git, linkProblem, ROOT } from "./repo.mjs";

/** The space kept clear around each card, in map units. */
const GAP = 12;

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const review = [];

/**
 * Checks one doc link.
 *
 * @param {string} where Which card, edge or step it is on.
 * @param {import("../public/js/data/types.js").DocRef} ref The link.
 */
const checkRef = (where, ref) => {
  if (!(ref.repo in SOURCES)) {
    errors.push(`${where}: unknown repo ${ref.repo}`);
    return;
  }
  const problem = linkProblem(ref.path);
  if (problem !== null) errors.push(`${where}: ${problem}`);
};

/**
 * Checks one map's references and layout.
 *
 * @param {import("../public/js/data/types.js").MapData} m The map.
 */
const checkMap = m => {
  const at = `${m.id}:`;
  const zones = new Map(m.zones.map(z => [z.id, z]));
  // Label widths, estimated from the fonts' average advance.
  for (const z of m.zones) {
    if (z.label.length * 9.3 + 30 > z.w)
      errors.push(`${at} zone ${z.id}: label too long`);
  }
  for (const g of m.groups) {
    if (g.label.length * 7.1 + 6 > g.w)
      errors.push(`${at} group ${g.id}: label too long`);
  }
  const ids = new Set();
  for (const n of m.nodes) {
    if (ids.has(n.id)) errors.push(`${at} duplicate node id: ${n.id}`);
    ids.add(n.id);
    const w = n.w ?? NODE_W;
    const z = zones.get(n.zone);
    if (!z) errors.push(`${at} node ${n.id}: unknown zone ${n.zone}`);
    else if (n.x < z.x || n.x + w > z.x + z.w)
      errors.push(`${at} node ${n.id}: sticks out of zone ${z.id}`);
    if (n.x < 0 || n.y < 40 || n.x + w > m.size.w || n.y + NODE_H > m.size.h) {
      errors.push(`${at} node ${n.id}: outside the map`);
    }
  }
  m.nodes.forEach((a, i) => {
    for (const b of m.nodes.slice(i + 1)) {
      const apart =
        a.x + (a.w ?? NODE_W) + GAP <= b.x ||
        b.x + (b.w ?? NODE_W) + GAP <= a.x ||
        a.y + NODE_H + GAP <= b.y ||
        b.y + NODE_H + GAP <= a.y;
      if (!apart) errors.push(`${at} nodes ${a.id} and ${b.id} overlap`);
    }
  });
  const edgeIds = new Set();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) errors.push(`${at} duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    for (const end of [e.from, e.to]) {
      if (!ids.has(end)) errors.push(`${at} edge ${e.id}: unknown node ${end}`);
    }
    const via = e.via ?? [];
    via.slice(1).forEach(([x, y], i) => {
      const [px, py] = via[i] ?? [x, y];
      if (x !== px && y !== py)
        errors.push(
          `${at} edge ${e.id}: via points ${i + 1} and ${i + 2} are not on one axis`,
        );
    });
  }
  const journeyIds = new Set();
  for (const j of m.journeys) {
    if (journeyIds.has(j.id))
      errors.push(`${at} duplicate journey id: ${j.id}`);
    journeyIds.add(j.id);
    j.steps.forEach((s, i) => {
      for (const end of [s.from, s.to]) {
        if (end !== undefined && !ids.has(end))
          errors.push(
            `${at} journey ${j.id} step ${i + 1}: unknown node ${end}`,
          );
      }
    });
  }
};

/**
 * Checks a node's links to other maps.
 *
 * @param {import("../public/js/data/types.js").MapData} m The map.
 * @param {import("../public/js/data/types.js").MapNode} n The node.
 */
const checkSee = (m, n) => {
  for (const l of n.see ?? []) {
    const other = MAPS.find(x => x.id === l.map);
    const where = `${m.id}: node ${n.id}: see`;
    if (!other) errors.push(`${where}: unknown map ${l.map}`);
    else if (l.node !== undefined && !other.nodes.some(x => x.id === l.node))
      errors.push(`${where}: unknown node ${l.map}/${l.node}`);
    else if (
      l.journey !== undefined &&
      !other.journeys.some(x => x.id === l.journey)
    ) {
      errors.push(`${where}: unknown journey ${l.map}/${l.journey}`);
    }
  }
};

/**
 * Checks that a node's status is backed by the repository.
 *
 * @param {import("../public/js/data/types.js").MapData} m The map.
 * @param {import("../public/js/data/types.js").MapNode} n The node.
 */
const checkStatus = (m, n) => {
  const where = `${m.id}: node ${n.id}`;
  const srcExists = n.src !== undefined && existsSync(join(ROOT, n.src));
  // A built or partial card points at its code; a partial one is expected to
  // have some, so only cards with no code yet are flagged for review.
  if (n.status === "built" || n.status === "partial") {
    if (
      !n.docs.some(
        ref =>
          ref.path.startsWith("packages/") || ref.path.startsWith("examples/"),
      )
    ) {
      errors.push(
        `${where}: ${n.status}, but links to no code under packages/ or examples/`,
      );
    }
    if (n.src !== undefined && !srcExists)
      errors.push(`${where}: ${n.status}, but ${n.src} does not exist`);
  } else if (srcExists) {
    review.push(`${where} is ${n.status}, but ${n.src} exists now`);
  }
};

// 1–3. Every map.
const mapIds = new Set();
for (const m of MAPS) {
  if (mapIds.has(m.id)) errors.push(`duplicate map id: ${m.id}`);
  mapIds.add(m.id);
  checkMap(m);
  for (const n of m.nodes) {
    checkSee(m, n);
    checkStatus(m, n);
    for (const ref of n.docs) checkRef(`${m.id}: node ${n.id}`, ref);
  }
  for (const e of m.edges)
    for (const ref of e.docs ?? []) checkRef(`${m.id}: edge ${e.id}`, ref);
  for (const j of m.journeys) {
    j.steps.forEach((s, i) => {
      for (const ref of s.docs ?? [])
        checkRef(`${m.id}: journey ${j.id} step ${i + 1}`, ref);
    });
  }
  console.log(
    `${m.id}: ${m.nodes.length} nodes, ${m.edges.length} edges, ${m.journeys.length} journeys`,
  );
}

// 4. What changed since the last sync.
const { synced } = SOURCES.ork;
const paths = [
  "packages",
  "docs",
  "examples",
  ":(exclude)docs/interaction-map",
];
const log = git([
  "log",
  "--oneline",
  "--no-merges",
  `${synced}..HEAD`,
  "--",
  ...paths,
]);
const dirty = git(["status", "--porcelain", "--", ...paths]);
console.log(
  `\nSynced at ${synced}; ${log ? log.split("\n").length : 0} commit(s) since touch packages, docs or examples.`,
);
if (log) console.log(log.replaceAll(/^/gmu, "   "));
if (dirty)
  console.log(`\nUncommitted changes:\n${dirty.replaceAll(/^/gmu, "   ")}`);
if (review.length > 0)
  console.log(
    `\nReview these statuses:\n${review.map(r => `   - ${r}`).join("\n")}`,
  );

// 5. The roadmap.
const roadmap = checkRoadmap();
errors.push(...roadmap.errors);
console.log(`\n${roadmap.summary}.`);
if (roadmap.review.length > 0)
  console.log(
    `Commits on no roadmap item (add them to one, or to OFF_ROADMAP):\n${roadmap.review.map(r => `   ${r}`).join("\n")}`,
  );

if (errors.length > 0) {
  console.error(
    `\n✗ ${errors.length} problem(s):\n${errors.map(e => `  - ${e}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("\n✓ Data and links are consistent.");
