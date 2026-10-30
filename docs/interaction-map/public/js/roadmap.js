/**
 * @file Renders the roadmap page from `data/roadmap.js`: a progress summary,
 *   the milestones with their items (the Roadmap view), and what is ahead and
 *   what shipped, by day (the Timeline view). Plain DOM, no dependencies.
 */

import { MILESTONES, ROADMAP_UPDATED } from "./data/roadmap.js";
import { SOURCES } from "./data/sources.js";

/** @typedef {import("./data/roadmap.js").Milestone} Milestone */
/** @typedef {import("./data/roadmap.js").RoadmapItem} RoadmapItem */
/** @typedef {import("./data/roadmap.js").Progress} Progress */

/** @type {Record<Progress, string>} */
const LABEL = {
  done: "Done",
  active: "In progress",
  next: "Next",
  planned: "Planned",
  waiting: "Waiting",
};

/** @type {Progress[]} */
const ORDER = ["done", "active", "next", "waiting", "planned"];

const REPO = SOURCES.ork;

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
const $ = selector => {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return found;
};

/**
 * Escapes HTML, then turns `backticks` into code.
 *
 * @param {string} text
 * @returns {string}
 */
const rich = text =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/`([^`]+)`/gu, "<code>$1</code>");

/**
 * A milestone's state, from its items: done when all are, active once any has
 * started, waiting when all wait, planned otherwise.
 *
 * @param {Milestone} milestone
 * @returns {Progress}
 */
const stateOf = milestone => {
  const statuses = milestone.items.map(i => i.status);
  if (statuses.every(s => s === "done")) return "done";
  if (statuses.every(s => s === "waiting")) return "waiting";
  if (statuses.some(s => s !== "planned" && s !== "waiting")) return "active";
  return "planned";
};

/**
 * @param {RoadmapItem[]} items
 * @returns {Record<Progress, number>}
 */
const counts = items => {
  /** @type {Record<Progress, number>} */
  const result = { done: 0, active: 0, next: 0, planned: 0, waiting: 0 };
  for (const item of items) result[item.status] += 1;
  return result;
};

/**
 * A bar with one segment per status, in `ORDER`.
 *
 * @param {RoadmapItem[]} items
 * @returns {string}
 */
const bar = items => {
  const by = counts(items);
  const total = Math.max(1, items.length);
  return `<div class="rm-bar" role="img" aria-label="${String(by.done)} of ${String(items.length)} done">${ORDER.filter(
    s => by[s] > 0,
  )
    .map(
      s =>
        `<span class="seg p-${s}" style="flex-grow:${String(by[s] / total)}" title="${LABEL[s]}: ${String(by[s])}"></span>`,
    )
    .join("")}</div>`;
};

/**
 * @param {Progress} status
 * @returns {string}
 */
const chip = status =>
  `<span class="rm-chip p-${status}"><i></i>${LABEL[status]}</span>`;

/**
 * @param {string} hash
 * @returns {string}
 */
const commitLink = hash =>
  `<a class="rm-commit" href="${REPO.github}/commit/${hash}" target="_blank" rel="noopener">${hash}</a>`;

/**
 * @param {string} doc A repository path, optionally with `#anchor`.
 * @returns {string}
 */
const docLink = doc => {
  const [file = doc, anchor] = doc.split("#");
  const name = file.split("/").at(-1) ?? file;
  return `<a class="rm-doc" href="${REPO.github}/blob/${REPO.branch}/${file}${anchor === undefined ? "" : `#${anchor}`}" target="_blank" rel="noopener">${name}${anchor === undefined ? "" : `<small>#${anchor}</small>`}</a>`;
};

/**
 * @param {string} date `YYYY-MM-DD`.
 * @returns {string}
 */
const day = date =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * @param {RoadmapItem} item
 * @param {Milestone} [milestone] Shown as a tag (on the timeline).
 * @returns {string}
 */
const itemHtml = (item, milestone) => {
  const meta = [
    ...(milestone === undefined
      ? []
      : [
          `<a class="rm-tag" href="#${milestone.id}">${rich(milestone.title)}</a>`,
        ]),
    ...(item.date === undefined || milestone !== undefined
      ? []
      : [`<span class="rm-date">${day(item.date)}</span>`]),
    ...(item.commits ?? []).map(commitLink),
    ...(item.docs ?? []).map(docLink),
  ];
  return `<li class="rm-item p-${item.status}" data-status="${item.status}">
    <span class="rm-dot" title="${LABEL[item.status]}"></span>
    <div class="rm-body">
      <div class="rm-title"><span>${rich(item.title)}</span>${item.status === "done" ? "" : chip(item.status)}</div>
      ${item.detail === undefined ? "" : `<p>${rich(item.detail)}</p>`}
      ${meta.length > 0 ? `<div class="rm-meta">${meta.join("")}</div>` : ""}
    </div>
  </li>`;
};

const allItems = MILESTONES.flatMap(m => m.items);

const renderSummary = () => {
  const by = counts(allItems);
  const done = by.done;
  const percent = Math.round((done / Math.max(1, allItems.length)) * 100);
  $("#rm-overall").innerHTML = `
    <div class="rm-figure"><b>${String(percent)}%</b><span>${String(done)} of ${String(allItems.length)} items shipped</span></div>
    ${bar(allItems)}`;

  const now = MILESTONES.flatMap(m =>
    m.items
      .filter(i => i.status === "active" || i.status === "next")
      .map(
        i =>
          `<a href="#${m.id}">${rich(i.title)}</a> <small>${rich(m.title)}</small>`,
      ),
  );
  $("#rm-now").innerHTML =
    now.length === 0 ? "Nothing in progress." : `Now: ${now.join(" · ")}`;

  $("#rm-strip").innerHTML = MILESTONES.map(m => {
    const state = stateOf(m);
    const c = counts(m.items);
    return `<li class="p-${state}"><a href="#${m.id}" title="${LABEL[state]}">
      <span class="rm-step"></span>
      <b>${rich(m.title.split(" · ")[0] ?? m.title)}</b>
      <small>${rich(m.title.split(" · ")[1] ?? "")}</small>
      <em>${String(c.done)}/${String(m.items.length)}</em>
    </a></li>`;
  }).join("");

  $("#rm-legend").innerHTML = ORDER.filter(s => by[s] > 0)
    .map(
      s =>
        `<li><button type="button" class="rm-filter p-${s}" data-filter="${s}" aria-pressed="false"><i></i>${LABEL[s]} <small>${String(by[s])}</small></button></li>`,
    )
    .join("");
};

const renderRoadmap = () => {
  $("#view-roadmap").innerHTML = MILESTONES.map(m => {
    const state = stateOf(m);
    const c = counts(m.items);
    return `<article id="${m.id}" class="rm-milestone p-${state}">
      <header>
        <div class="rm-mhead">
          <h2>${rich(m.title)}</h2>
          ${chip(state)}
          <span class="rm-count">${String(c.done)} of ${String(m.items.length)}</span>
        </div>
        <p>${rich(m.goal)}</p>
        ${bar(m.items)}
      </header>
      <ul class="rm-items">${m.items.map(i => itemHtml(i)).join("")}</ul>
    </article>`;
  }).join("");
};

const renderTimeline = () => {
  const ahead = MILESTONES.flatMap(m =>
    m.items
      .filter(i => i.status !== "done")
      .map(i => ({ item: i, milestone: m })),
  ).toSorted(
    (a, b) => ORDER.indexOf(a.item.status) - ORDER.indexOf(b.item.status),
  );
  /** @type {Map<string, { item: RoadmapItem; milestone: Milestone }[]>} */
  const shipped = new Map();
  for (const milestone of MILESTONES) {
    for (const item of milestone.items) {
      if (item.status !== "done" || item.date === undefined) continue;
      shipped.set(item.date, [
        ...(shipped.get(item.date) ?? []),
        { item, milestone },
      ]);
    }
  }
  const days = [...shipped.keys()].toSorted().toReversed();
  $("#view-timeline").innerHTML = `
    <ol class="rm-timeline">
      <li class="rm-day rm-ahead">
        <h2>Ahead <small>${String(ahead.length)} items</small></h2>
        <ul class="rm-items">${ahead.map(e => itemHtml(e.item, e.milestone)).join("")}</ul>
      </li>
      <li class="rm-today"><span>Today</span></li>
      ${days
        .map(
          d => `<li class="rm-day">
        <h2>${day(d)} <small>${String(shipped.get(d)?.length ?? 0)} shipped</small></h2>
        <ul class="rm-items">${(shipped.get(d) ?? [])
          .toReversed()
          .map(e => itemHtml(e.item, e.milestone))
          .join("")}</ul>
      </li>`,
        )
        .join("")}
    </ol>`;
};

/** Shows the view the hash names; a milestone id opens the roadmap at it. */
const route = () => {
  const target = location.hash.slice(1) || "roadmap";
  const view = target === "timeline" ? "timeline" : "roadmap";
  $("#view-roadmap").hidden = view !== "roadmap";
  $("#view-timeline").hidden = view !== "timeline";
  for (const tab of document.querySelectorAll(".rm-tabs a")) {
    tab.setAttribute(
      "aria-current",
      tab instanceof HTMLElement && tab.dataset["view"] === view
        ? "page"
        : "false",
    );
  }
  if (view === "roadmap" && target !== "roadmap") {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth" });
  } else {
    window.scrollTo({ top: 0 });
  }
};

/** @type {Progress | null} */
let filter = null;

/** Shows only items with the chosen status, or all. */
const applyFilter = () => {
  for (const item of document.querySelectorAll(".rm-item")) {
    if (item instanceof HTMLElement) {
      item.hidden = filter !== null && item.dataset["status"] !== filter;
    }
  }
  for (const button of document.querySelectorAll(".rm-filter")) {
    if (button instanceof HTMLElement) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset["filter"] === filter),
      );
    }
  }
};

const toggleTheme = () => {
  const root = document.documentElement;
  const dark = root.dataset["theme"]
    ? root.dataset["theme"] === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset["theme"] = dark ? "light" : "dark";
  try {
    localStorage.setItem("se-map-theme", root.dataset["theme"]);
  } catch {
    // Remembering the theme is a convenience.
  }
};

renderSummary();
renderRoadmap();
renderTimeline();
$("#rm-footer").innerHTML =
  `Updated ${day(ROADMAP_UPDATED)} · from <code>docs/interaction-map/public/js/data/roadmap.js</code> · checked by <code>pnpm map:check</code>`;

$("#rm-legend").addEventListener("click", event => {
  const button =
    event.target instanceof Element ? event.target.closest(".rm-filter") : null;
  if (!(button instanceof HTMLElement)) return;
  const chosen = /** @type {Progress} */ (button.dataset["filter"]);
  filter = filter === chosen ? null : chosen;
  applyFilter();
});
$("#theme-btn").addEventListener("click", toggleTheme);
addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "t" || event.key === "T") toggleTheme();
});
addEventListener("hashchange", route);
route();
