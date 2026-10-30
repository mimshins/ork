/**
 * @file Entry point: builds the current map and wires the map switcher, the
 *   panel, the journeys, search, the legend, keys, and the URL hash (`#<map>`,
 *   `#<map>/node/<id>`, `#<map>/edge/<id>`, `#<map>/journey/<id>/<step>`), so
 *   any view can be linked to. Hashes without a map (`#node/<id>`, from before
 *   there were several maps) open the first map.
 */

import { MAPS } from "./data/maps.js";
import { SOURCES, SYNCED_ON } from "./data/sources.js";
import { pickerHtml, stepperHtml } from "./journey.js";
import { commitUrl } from "./lib/docs.js";
import { $, esc, plain } from "./lib/dom.js";
import { createMap } from "./map.js";
import { mapById, toneOf } from "./model.js";
import { KIND_LABEL, STATUS_LABEL, edgeHtml, nodeHtml } from "./panel.js";

/** @typedef {import("./data/types.js").Status} Status */
/** @typedef {import("./data/types.js").MapData} MapData */

/** How long autoplay shows each step, in ms. */
const STEP_MS = 4800;

const stage = $("#stage");
const panel = $("#panel");
const panelBody = $("#panel-body");
const stepper = $("#stepper");
const menu = $("#journey-menu");
const menuBtn = $("#journeys-btn");
const mapMenu = $("#map-menu");
const mapBtn = $("#maps-btn");
const search = /** @type {HTMLInputElement} */ ($("#search"));
const results = $("#search-results");
const legend = $("#legend");
if (matchMedia("(max-width: 760px)").matches)
  legend.classList.add("is-collapsed");

/**
 * @type {{
 *   sel: { kind: "node" | "edge"; id: string } | null;
 *   journey: string | null;
 *   step: number;
 *   playing: boolean;
 *   list: boolean;
 *   status: Status | null;
 * }}
 */
const ui = {
  sel: null,
  journey: null,
  step: 0,
  playing: false,
  list: false,
  status: null,
};
/** @type {number | null} */
let timer = null;

const isNarrow = () => matchMedia("(max-width: 760px)").matches;

/** The map on screen. */
let cur = MAPS[0];

/** @type {import("./map.js").MapEvents} */
const events = {
  onNode: id => select("node", id),
  onEdge: id => select("edge", id),
  onStep: i => goStep(i),
  onBackground: () => {
    closeMenus();
    if (ui.sel) closePanel();
  },
  insets: () => {
    const top = $(".topbar").getBoundingClientRect().bottom + 8;
    const narrow = isNarrow();
    const right =
      !narrow && ui.sel ? panel.getBoundingClientRect().width + 24 : 16;
    let bottom = 16;
    if (ui.journey)
      bottom = Math.max(
        bottom,
        stage.clientHeight - stepper.getBoundingClientRect().top + 12,
      );
    if (narrow && ui.sel)
      bottom = Math.max(
        bottom,
        stage.clientHeight - panel.getBoundingClientRect().top + 12,
      );
    const left =
      !narrow && !ui.journey && !legend.classList.contains("is-collapsed")
        ? legend.getBoundingClientRect().width + 24
        : 16;
    return { top, right, bottom, left };
  },
};

/**
 * A fresh container for a map, on the stage.
 *
 * @returns {HTMLElement} The container.
 */
const newHost = () => {
  const el = document.createElement("div");
  el.className = "map-host";
  stage.append(el);
  return el;
};

let host = newHost();
let map = createMap(host, cur, events);

/**
 * Shows another map, closing whatever was open on this one.
 *
 * @param {MapData} next The map.
 */
const showMap = next => {
  if (next === cur) return;
  stopPlay();
  closeMenus();
  ui.sel = null;
  ui.journey = null;
  ui.list = false;
  ui.status = null;
  panel.hidden = true;
  stepper.hidden = true;
  document.body.classList.remove("panel-open", "journey-open");
  cur = next;
  host.remove();
  host = newHost();
  map = createMap(host, cur, events);
  renderChrome();
};

// ── Selection and the panel ──────────────────────────────────────────────

/**
 * Opens a node or an edge in the panel.
 *
 * @param {"node" | "edge"} kind What to open.
 * @param {string} id Its id.
 * @param {{ focus?: boolean }} [opts] Whether to pan to it.
 */
const select = (kind, id, opts = {}) => {
  closeMenus();
  ui.sel = { kind, id };
  panelBody.innerHTML = kind === "node" ? nodeHtml(cur, id) : edgeHtml(cur, id);
  panelBody.scrollTop = 0;
  panel.hidden = false;
  document.body.classList.add("panel-open");
  if (kind === "node") map.selectNode(id);
  else map.selectEdge(id);
  if (opts.focus && kind === "node")
    requestAnimationFrame(() => map.focusNode(id));
  if (opts.focus && kind === "edge") {
    const e = cur.edges.find(x => x.id === id);
    if (e) requestAnimationFrame(() => map.focusNodes([e.from, e.to]));
  }
  writeHash();
};

const closePanel = () => {
  ui.sel = null;
  panel.hidden = true;
  document.body.classList.remove("panel-open");
  map.selectNode(null);
  map.previewEdge(null);
  writeHash();
};

panel.addEventListener("click", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest(
    "[data-map],[data-node],[data-edge],[data-journey],[data-act]",
  );
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.map) {
    const next = mapById(t.dataset.map);
    if (!next) return;
    showMap(next);
    if (t.dataset.node) select("node", t.dataset.node, { focus: true });
    else if (t.dataset.journey) openJourney(t.dataset.journey);
    else writeHash();
  } else if (t.dataset.act === "close-panel") closePanel();
  else if (t.dataset.node) select("node", t.dataset.node, { focus: true });
  else if (t.dataset.edge) select("edge", t.dataset.edge, { focus: true });
  else if (t.dataset.journey)
    openJourney(t.dataset.journey, Number(t.dataset.step ?? 0));
});
panel.addEventListener("pointerover", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest("[data-edge]");
  map.previewEdge(t instanceof HTMLElement ? (t.dataset.edge ?? null) : null);
});
panel.addEventListener("pointerleave", () => map.previewEdge(null));

// ── Journeys ─────────────────────────────────────────────────────────────

/**
 * Opens a journey at a step.
 *
 * @param {string} id The journey's id.
 * @param {number} [step] The step's index.
 */
const openJourney = (id, step = 0) => {
  const j = cur.journeys.find(x => x.id === id);
  if (!j) return;
  closeMenus();
  ui.journey = id;
  ui.status = null;
  syncLegend();
  map.filterStatus(null);
  stepper.hidden = false;
  document.body.classList.add("journey-open");
  goStep(Math.min(Math.max(0, step), j.steps.length - 1));
};

/** @param {number} i The step's index. */
const goStep = i => {
  const j = cur.journeys.find(x => x.id === ui.journey);
  if (!j) return;
  ui.step = Math.min(Math.max(0, i), j.steps.length - 1);
  renderStepper();
  map.setJourney(j, ui.step);
  const s = j.steps[ui.step];
  requestAnimationFrame(() => map.focusNodes(s.to ? [s.from, s.to] : [s.from]));
  writeHash();
};

const renderStepper = () => {
  const j = cur.journeys.find(x => x.id === ui.journey);
  if (!j) return;
  stepper.innerHTML = stepperHtml(cur, j, ui.step, ui.playing, ui.list);
  stepper
    .querySelector(".step-list .is-current")
    ?.scrollIntoView({ block: "nearest" });
};

const closeJourney = () => {
  stopPlay();
  ui.journey = null;
  ui.list = false;
  stepper.hidden = true;
  document.body.classList.remove("journey-open");
  map.setJourney(null, 0);
  writeHash();
};

const stopPlay = () => {
  ui.playing = false;
  if (timer !== null) clearInterval(timer);
  timer = null;
};

const togglePlay = () => {
  const j = cur.journeys.find(x => x.id === ui.journey);
  if (!j) return;
  if (ui.playing) {
    stopPlay();
    renderStepper();
    return;
  }
  ui.playing = true;
  if (ui.step === j.steps.length - 1) goStep(0);
  else renderStepper();
  timer = window.setInterval(() => {
    if (ui.step >= j.steps.length - 1) {
      stopPlay();
      renderStepper();
    } else goStep(ui.step + 1);
  }, STEP_MS);
};

stepper.addEventListener("click", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest(
    "[data-act],[data-step],[data-node]",
  );
  if (!(t instanceof HTMLElement)) return;
  const act = t.dataset.act;
  if (act === "close") closeJourney();
  else if (act === "play") togglePlay();
  else if (act === "list") {
    ui.list = !ui.list;
    renderStepper();
  } else if (act === "prev" || act === "next" || t.dataset.step !== undefined) {
    stopPlay();
    goStep(
      act === "prev"
        ? ui.step - 1
        : act === "next"
          ? ui.step + 1
          : Number(t.dataset.step),
    );
  } else if (t.dataset.node) select("node", t.dataset.node);
});

menuBtn.addEventListener("click", ev => {
  ev.stopPropagation();
  const open = menu.hidden;
  closeMenus();
  if (open) {
    menu.innerHTML = pickerHtml(cur, ui.journey);
    menu.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    /** @type {HTMLElement | null} */ (
      menu.querySelector(".journey-item")
    )?.focus();
  }
});
menu.addEventListener("click", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest("[data-journey]");
  if (t instanceof HTMLElement && t.dataset.journey)
    openJourney(t.dataset.journey);
});
/**
 * Arrow keys move between a menu's items.
 *
 * @param {HTMLElement} el The menu.
 * @param {string} selector Its items.
 */
const arrowKeys = (el, selector) =>
  el.addEventListener("keydown", ev => {
    const items = /** @type {HTMLElement[]} */ ([
      ...el.querySelectorAll(selector),
    ]);
    const i = items.indexOf(
      /** @type {HTMLElement} */ (document.activeElement),
    );
    if (ev.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (ev.key === "ArrowUp")
      items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    ev.preventDefault();
  });
arrowKeys(menu, ".journey-item");

// ── The map switcher ─────────────────────────────────────────────────────

const mapMenuHtml = () =>
  MAPS.map(
    m => `<button role="menuitem" class="map-item${m === cur ? " is-active" : ""}" data-map="${esc(m.id)}">
      <span class="mi-title">${esc(m.title)}<small>${m.nodes.length} components · ${m.journeys.length} journeys</small></span>
      <span class="mi-sub">${esc(m.sub)}</span>
    </button>`,
  ).join("");

mapBtn.addEventListener("click", ev => {
  ev.stopPropagation();
  const open = mapMenu.hidden;
  closeMenus();
  if (open) {
    mapMenu.innerHTML = mapMenuHtml();
    mapMenu.hidden = false;
    mapBtn.setAttribute("aria-expanded", "true");
    /** @type {HTMLElement | null} */ (
        mapMenu.querySelector(".map-item.is-active") ??
        mapMenu.querySelector(".map-item")
    )?.focus();
  }
});
mapMenu.addEventListener("click", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest("[data-map]");
  const next =
    t instanceof HTMLElement && t.dataset.map
      ? mapById(t.dataset.map)
      : undefined;
  if (!next) return;
  closeMenus();
  showMap(next);
  writeHash();
});
arrowKeys(mapMenu, ".map-item");

// ── Search ───────────────────────────────────────────────────────────────

/** @type {{ map: MapData; kind: "node" | "journey"; id: string }[]} */
let hits = [];
let hit = 0;

const runSearch = () => {
  const q = search.value.trim().toLowerCase();
  if (!q) {
    results.hidden = true;
    hits = [];
    return;
  }
  const score = (/** @type {string} */ title, /** @type {string} */ rest) =>
    title.toLowerCase().startsWith(q)
      ? 3
      : title.toLowerCase().includes(q)
        ? 2
        : rest.toLowerCase().includes(q)
          ? 1
          : 0;
  // The map on screen first, then the others, best matches first within each.
  const order = [cur, ...MAPS.filter(m => m !== cur)];
  const nodeHits = order
    .flatMap((m, k) =>
      m.nodes.map(n => ({
        m,
        n,
        s: score(n.title, [n.sub, n.summary, ...n.facts].join(" ")) * 10 - k,
      })),
    )
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  const journeyHits = order
    .flatMap((m, k) =>
      m.journeys.map(j => ({ m, j, s: score(j.title, j.summary) * 10 - k })),
    )
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  hits = [
    ...nodeHits.map(x => ({
      map: x.m,
      kind: /** @type {const} */ ("node"),
      id: x.n.id,
    })),
    ...journeyHits.map(x => ({
      map: x.m,
      kind: /** @type {const} */ ("journey"),
      id: x.j.id,
    })),
  ];
  hit = 0;
  /** @param {MapData} m */
  const where = m => (m === cur ? "" : `${esc(m.title)} · `);
  results.innerHTML =
    hits.length === 0
      ? `<li class="empty">Nothing matches “${esc(search.value)}”</li>`
      : [
          ...nodeHits.map(
            ({ m, n }, k) =>
              `<li><button data-k="${k}" class="tone-${toneOf(m, n)}${k === 0 ? " is-active" : ""}"><span class="zone-dot"></span><b>${esc(n.title)}</b><small>${where(m)}${esc(plain(n.sub))}</small></button></li>`,
          ),
          ...journeyHits.map(
            ({ m, j }, k) =>
              `<li><button data-k="${nodeHits.length + k}" class="is-journey${nodeHits.length + k === 0 ? " is-active" : ""}"><span class="zone-dot"></span><b>${esc(j.title)}</b><small>${where(m)}Journey · ${j.steps.length} steps</small></button></li>`,
          ),
        ].join("");
  results.hidden = false;
};

/** @param {number} k */
const pick = k => {
  const h = hits[k];
  if (!h) return;
  search.value = "";
  results.hidden = true;
  search.blur();
  showMap(h.map);
  if (h.kind === "node") select("node", h.id, { focus: true });
  else openJourney(h.id);
};

search.addEventListener("input", runSearch);
search.addEventListener("focus", runSearch);
search.addEventListener("keydown", ev => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (hits.length === 0) return;
    hit = (hit + (ev.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
    results
      .querySelectorAll("button")
      .forEach((b, k) => b.classList.toggle("is-active", k === hit));
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    pick(hit);
  } else if (ev.key === "Escape") {
    search.value = "";
    results.hidden = true;
    search.blur();
  }
});
results.addEventListener("pointerdown", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest("[data-k]");
  if (t instanceof HTMLElement) {
    ev.preventDefault();
    pick(Number(t.dataset.k));
  }
});
search.addEventListener("blur", () =>
  setTimeout(() => (results.hidden = true), 120),
);

// ── Legend, zoom, theme ──────────────────────────────────────────────────

const statusKeys = /** @type {Status[]} */ (Object.keys(STATUS_LABEL));

/**
 * Draws what belongs to the map on screen: the switcher's label, the title, the
 * legend.
 */
const renderChrome = () => {
  $("#map-title").textContent = cur.title;
  document.title = `${cur.title} · Ork map`;
  $("#legend-status").innerHTML = statusKeys
    .map(
      s =>
        `<li><button class="legend-status status-${s}" data-status="${s}" aria-pressed="false"><i></i>${STATUS_LABEL[s]}<small>${
          cur.nodes.filter(n => n.status === s).length
        }</small></button></li>`,
    )
    .join("");
  const kinds = new Set(cur.edges.map(e => e.kind));
  $("#legend-kinds").innerHTML = /** @type {keyof typeof KIND_LABEL[]} */ (
    Object.keys(KIND_LABEL)
  )
    .filter(k => kinds.has(k))
    .map(
      k =>
        `<li class="kind-${k}"><svg viewBox="0 0 34 8" aria-hidden="true"><path d="M1 4H31"/></svg>${KIND_LABEL[k]}</li>`,
    )
    .join("");
};
$("#legend-synced").innerHTML = `Synced ${esc(SYNCED_ON)}: ${
  /** @type {keyof typeof SOURCES[]} */ (Object.keys(SOURCES))
    .map(
      r =>
        `<a href="${esc(commitUrl(r))}" target="_blank" rel="noopener noreferrer">${esc(SOURCES[r].short)} <code>${esc(SOURCES[r].synced)}</code></a>`,
    )
    .join(" · ")
}`;

const syncLegend = () => {
  legend.querySelectorAll("[data-status]").forEach(b => {
    const on = /** @type {HTMLElement} */ (b).dataset.status === ui.status;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
};

legend.addEventListener("click", ev => {
  const t = /** @type {HTMLElement} */ (ev.target).closest(
    "[data-status],[data-act]",
  );
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.act === "legend") {
    const collapsed = legend.classList.toggle("is-collapsed");
    t.setAttribute("aria-expanded", String(!collapsed));
    if (!ui.sel && !ui.journey) map.fit();
    return;
  }
  const s = /** @type {Status} */ (t.dataset.status);
  if (ui.journey) closeJourney();
  ui.status = ui.status === s ? null : s;
  map.filterStatus(ui.status);
  syncLegend();
});

$("#zoom-in").addEventListener("click", () => map.zoomBy(1.25));
$("#zoom-out").addEventListener("click", () => map.zoomBy(0.8));
$("#zoom-fit").addEventListener("click", () => map.fit());

const toggleTheme = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("se-map-theme", root.dataset.theme);
  } catch {
    // Storage may be unavailable (private mode); the toggle still works for this visit.
  }
};
$("#theme-btn").addEventListener("click", toggleTheme);

const closeMenus = () => {
  menu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
  mapMenu.hidden = true;
  mapBtn.setAttribute("aria-expanded", "false");
};
document.addEventListener("click", ev => {
  if (
    !(
      /** @type {HTMLElement} */ (ev.target).closest(
        "#journey-menu,#journeys-btn,#map-menu,#maps-btn",
      )
    )
  )
    closeMenus();
});

// ── Keys ─────────────────────────────────────────────────────────────────

document.addEventListener("keydown", ev => {
  const typing = /** @type {HTMLElement} */ (ev.target).closest(
    "input, textarea",
  );
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === "Escape") {
    if (!menu.hidden || !mapMenu.hidden) closeMenus();
    else if (ui.sel) closePanel();
    else if (ui.journey) closeJourney();
    else if (ui.status) {
      ui.status = null;
      map.filterStatus(null);
      syncLegend();
    }
  } else if (ev.key === "/") {
    ev.preventDefault();
    search.focus();
  } else if (ev.key === "j" || ev.key === "J") {
    menuBtn.click();
  } else if (ev.key === "m" || ev.key === "M") {
    mapBtn.click();
  } else if (ev.key === "t" || ev.key === "T") {
    toggleTheme();
  } else if (ev.key === "0" || ev.key === "f" || ev.key === "F") {
    map.fit();
  } else if (ev.key === "+" || ev.key === "=") {
    map.zoomBy(1.25);
  } else if (ev.key === "-") {
    map.zoomBy(0.8);
  } else if (ui.journey && ev.key === "ArrowRight") {
    stopPlay();
    goStep(ui.step + 1);
  } else if (ui.journey && ev.key === "ArrowLeft") {
    stopPlay();
    goStep(ui.step - 1);
  } else if (
    ui.journey &&
    ev.key === " " &&
    !(/** @type {HTMLElement} */ (ev.target).closest("button"))
  ) {
    ev.preventDefault();
    togglePlay();
  }
});

// ── The URL hash ─────────────────────────────────────────────────────────

let writing = false;

const writeHash = () => {
  const rest = ui.journey
    ? `/journey/${ui.journey}/${ui.step + 1}`
    : ui.sel
      ? `/${ui.sel.kind}/${ui.sel.id}`
      : "";
  const h = rest || cur !== MAPS[0] ? `#${cur.id}${rest}` : "";
  if (location.hash === h || (!h && !location.hash)) return;
  writing = true;
  history.replaceState(null, "", h || location.pathname + location.search);
  writing = false;
};

const readHash = () => {
  if (writing) return;
  const parts = location.hash.slice(1).split("/");
  const legacy = ["node", "edge", "journey"].includes(parts[0]);
  const next = (legacy ? undefined : mapById(parts[0])) ?? MAPS[0];
  const [kind, id, step] = legacy ? parts : parts.slice(1);
  showMap(next);
  if (kind === "journey" && id) openJourney(id, Number(step ?? 1) - 1);
  else if (kind === "node" && id && cur.nodes.some(n => n.id === id))
    select("node", id, { focus: true });
  else if (kind === "edge" && id && cur.edges.some(e => e.id === id))
    select("edge", id, { focus: true });
  else if (ui.sel) closePanel();
  else if (ui.journey) closeJourney();
};

renderChrome();
window.addEventListener("hashchange", readHash);
window.addEventListener("resize", () => {
  if (!ui.journey && !ui.sel) map.fit(false);
});
readHash();
