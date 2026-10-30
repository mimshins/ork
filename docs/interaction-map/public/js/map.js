/**
 * @file The interactive map: draws zones, groups, edges and cards into one SVG,
 *   handles pan and zoom (drag, wheel, pinch, keys), and lights up what is
 *   selected, hovered, filtered, or part of the current journey step.
 */

import { NODE_W } from "./data/types.js";
import { connect, rectOf } from "./geometry.js";
import { plain, svg } from "./lib/dom.js";
import { edgeBetween, nodeOf, toneOf } from "./model.js";

/** @typedef {import("./data/types.js").MapData} MapData */
/** @typedef {import("./data/types.js").MapNode} MapNode */
/** @typedef {import("./data/types.js").Journey} Journey */
/** @typedef {import("./data/types.js").Status} Status */
/** @typedef {import("./geometry.js").Rect} Rect */

/**
 * What the map reports back to the page.
 *
 * @typedef {object} MapEvents
 * @property {(id: string) => void} onNode A card was clicked or activated.
 * @property {(id: string) => void} onEdge An edge was clicked.
 * @property {(index: number) => void} onStep A journey badge was clicked.
 * @property {() => void} onBackground The empty map was clicked.
 * @property {() => {
 *   top: number;
 *   right: number;
 *   bottom: number;
 *   left: number;
 * }} insets
 *   The screen space covered by floating UI, in pixels, so focusing keeps
 *   things visible.
 */

/** Grid spacing of the dotted background, in map units. */
const GRID = 24;

/** Where repeated badges on one path sit, as fractions of its length. */
const BADGE_T = [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6];

/**
 * Builds one map in a container. To show another map, build it in a new
 * container: the listeners live on this one.
 *
 * @param {HTMLElement} host The container; the SVG fills it.
 * @param {MapData} m The map.
 * @param {MapEvents} events Callbacks.
 */
export const createMap = (host, m, events) => {
  const root = /** @type {SVGSVGElement} */ (
    svg("svg", {
      class: "map",
      role: "img",
      "aria-label": `Ork ${m.title} map`,
    })
  );
  const viewport = svg("g", { class: "viewport" });
  const layers = {
    zones: svg("g", { class: "zones" }),
    groups: svg("g", { class: "groups" }),
    edges: svg("g", { class: "edges" }),
    journey: svg("g", { class: "journey-paths" }),
    nodes: svg("g", { class: "nodes" }),
    badges: svg("g", { class: "journey-badges" }),
    tags: svg("g", { class: "edge-tags" }),
  };
  root.append(defs());
  viewport.append(...Object.values(layers));
  root.append(viewport);
  host.append(root);

  /** @type {Map<string, SVGElement>} */ const nodeEls = new Map();
  /** @type {Map<string, SVGElement>} */ const edgeEls = new Map();
  /** @type {Map<string, import("./geometry.js").Geometry>} */ const edgeGeo =
    new Map();

  // ── Drawing ──────────────────────────────────────────────────────────────
  for (const z of m.zones) {
    layers.zones.append(
      svg("rect", {
        class: `zone tone-${z.tone}`,
        x: z.x,
        y: 0,
        width: z.w,
        height: m.size.h,
        rx: 28,
      }),
      svg("text", { class: `zone-label tone-${z.tone}`, x: z.x + 22, y: 26 }, [
        z.label.toUpperCase(),
      ]),
    );
  }
  for (const g of m.groups) {
    layers.groups.append(
      svg("rect", {
        class: "group",
        x: g.x,
        y: g.y,
        width: g.w,
        height: g.h,
        rx: 18,
      }),
      svg("text", { class: "group-label", x: g.x + 6, y: g.y - 8 }, [g.label]),
    );
  }
  for (const e of m.edges) {
    const from = nodeOf(m, e.from);
    const to = nodeOf(m, e.to);
    if (!from || !to) continue;
    const geo = connect(from, to, e.via);
    edgeGeo.set(e.id, geo);
    const status = e.status ?? "built";
    const g = svg("g", {
      class: `edge kind-${e.kind} status-${status}`,
      "data-id": e.id,
    });
    const line = svg("path", {
      class: "edge-line",
      d: geo.d,
      "marker-end": `url(#arr-${e.kind})`,
      ...(e.both ? { "marker-start": `url(#arr-${e.kind})` } : {}),
    });
    const hit = svg("path", { class: "edge-hit", d: geo.d });
    g.append(line, hit);
    g.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!moved) events.onEdge(e.id);
    });
    g.addEventListener("pointerenter", () => setHoverEdge(e.id));
    g.addEventListener("pointerleave", () => setHoverEdge(null));
    layers.edges.append(g);
    edgeEls.set(e.id, g);
  }
  for (const n of m.nodes) {
    const el = drawNode(n, toneOf(m, n));
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!moved) events.onNode(n.id);
    });
    el.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        events.onNode(n.id);
      }
    });
    el.addEventListener("pointerenter", () => setHoverNode(n.id));
    el.addEventListener("pointerleave", () => setHoverNode(null));
    el.addEventListener("focus", () => setHoverNode(n.id));
    el.addEventListener("blur", () => setHoverNode(null));
    layers.nodes.append(el);
    nodeEls.set(n.id, el);
  }
  fitText(m, nodeEls);

  // ── Light-up state ───────────────────────────────────────────────────────
  /**
   * @type {{
   *   node: string | null;
   *   edge: string | null;
   *   hoverNode: string | null;
   *   hoverEdge: string | null;
   *   status: Status | null;
   *   journey: Journey | null;
   *   step: number;
   * }}
   */
  const state = {
    node: null,
    edge: null,
    hoverNode: null,
    hoverEdge: null,
    status: null,
    journey: null,
    step: 0,
  };

  /** @param {string | null} id */
  const setHoverNode = id => {
    state.hoverNode = id;
    refresh();
  };
  /** @param {string | null} id */
  const setHoverEdge = id => {
    state.hoverEdge = id;
    refresh();
  };

  const refresh = () => {
    /** @type {Set<string>} */ const litNodes = new Set();
    /** @type {Set<string>} */ const litEdges = new Set();
    let focused = false;

    if (state.journey) {
      focused = true;
      for (const s of state.journey.steps) {
        litNodes.add(s.from);
        if (s.to) litNodes.add(s.to);
      }
    } else if (state.status) {
      focused = true;
      for (const n of m.nodes)
        if (n.status === state.status) litNodes.add(n.id);
      for (const e of m.edges)
        if ((e.status ?? "built") === state.status) litEdges.add(e.id);
    } else {
      const nodeId = state.node ?? (state.edge ? null : state.hoverNode);
      const edgeId = state.edge ?? (state.node ? null : state.hoverEdge);
      if (nodeId) {
        focused = true;
        litNodes.add(nodeId);
        for (const e of m.edges) {
          if (e.from === nodeId || e.to === nodeId) {
            litEdges.add(e.id);
            litNodes.add(e.from);
            litNodes.add(e.to);
          }
        }
      } else if (edgeId) {
        const e = m.edges.find(x => x.id === edgeId);
        if (e) {
          focused = true;
          litEdges.add(e.id);
          litNodes.add(e.from);
          litNodes.add(e.to);
        }
      }
    }

    root.classList.toggle("is-focused", focused);
    root.classList.toggle("in-journey", Boolean(state.journey));
    for (const [id, el] of nodeEls) {
      el.classList.toggle("is-lit", litNodes.has(id));
      el.classList.toggle("is-selected", state.node === id);
    }
    for (const [id, el] of edgeEls) {
      el.classList.toggle("is-lit", litEdges.has(id));
      el.classList.toggle("is-selected", state.edge === id);
    }
    drawTag();
  };

  /**
   * Shows the label of the hovered or selected edge, or of every lit edge of a
   * selected node.
   */
  const drawTag = () => {
    layers.tags.replaceChildren();
    if (state.journey) return;
    const ids = new Set();
    if (state.edge) ids.add(state.edge);
    else if (state.hoverEdge) ids.add(state.hoverEdge);
    const nodeId = state.node ?? state.hoverNode;
    if (!state.edge && nodeId)
      for (const e of m.edges)
        if (e.from === nodeId || e.to === nodeId) ids.add(e.id);
    for (const id of ids) {
      const e = m.edges.find(x => x.id === id);
      const geo = edgeGeo.get(id);
      if (!e || !geo) continue;
      layers.tags.append(tag(geo.at(0.5), e.label, `tag kind-${e.kind}`));
    }
    sizeTags(layers.tags);
  };

  // ── Journey overlay ──────────────────────────────────────────────────────
  const drawJourney = () => {
    layers.journey.replaceChildren();
    layers.badges.replaceChildren();
    for (const el of nodeEls.values())
      el.classList.remove("is-current", "is-step-end");
    const j = state.journey;
    if (!j) return;

    /** @type {Map<string, number>} */ const seen = new Map();
    j.steps.forEach((s, i) => {
      const from = nodeOf(m, s.from);
      if (!from) return;
      const to = s.to ? nodeOf(m, s.to) : undefined;
      const when =
        i < state.step
          ? "is-past"
          : i === state.step
            ? "is-current"
            : "is-future";
      const key = to ? [s.from, s.to].sort().join("|") : `self|${s.from}`;
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);

      /** @type {{ x: number; y: number }} */ let at;
      if (to) {
        const match = edgeBetween(m, s.from, /** @type {string} */ (s.to));
        const geo = connect(from, to, match?.edge.via, match?.reverse);
        layers.journey.append(
          svg("path", {
            class: `jpath ${when}${s.status ? " is-" + s.status : ""}`,
            d: geo.d,
            "marker-end": `url(#arr-journey${i === state.step ? "-current" : ""})`,
          }),
        );
        at = geo.at(BADGE_T[k % BADGE_T.length]);
      } else {
        const r = rectOf(from);
        at = { x: r.x + 16 + k * 26, y: r.y };
      }
      const badge = svg(
        "g",
        {
          class: `badge ${when}`,
          transform: `translate(${at.x},${at.y})`,
          role: "button",
          "aria-label": `Step ${i + 1}: ${plain(s.title)}`,
        },
        [
          svg("circle", { r: 12 }),
          svg("text", { "text-anchor": "middle", dy: "0.35em" }, [
            String(i + 1),
          ]),
        ],
      );
      badge.addEventListener("click", ev => {
        ev.stopPropagation();
        if (!moved) events.onStep(i);
      });
      layers.badges.append(badge);
      if (i === state.step) {
        nodeEls.get(s.from)?.classList.add("is-current");
        if (s.to) nodeEls.get(s.to)?.classList.add("is-current", "is-step-end");
      }
    });
    // The current badge on top of the others.
    const current = layers.badges.children[state.step];
    if (current) layers.badges.append(current);
  };

  // ── Pan and zoom ─────────────────────────────────────────────────────────
  const view = { k: 1, x: 0, y: 0 };
  let moved = false;
  /** @type {number | null} */ let anim = null;

  const apply = () => {
    viewport.setAttribute(
      "transform",
      `translate(${view.x},${view.y}) scale(${view.k})`,
    );
    host.style.backgroundSize = `${GRID * view.k}px ${GRID * view.k}px`;
    host.style.backgroundPosition = `${view.x}px ${view.y}px`;
    host.style.setProperty("--zoom", String(view.k));
  };

  const stopAnim = () => {
    if (anim !== null) cancelAnimationFrame(anim);
    anim = null;
  };

  /** @param {number} k */
  const clampK = k => Math.min(2.4, Math.max(0.18, k));

  /**
   * Moves the view, animated unless the user prefers less motion.
   *
   * @param {{ k: number; x: number; y: number }} to The target view.
   * @param {number} [ms] Duration.
   */
  const animateTo = (to, ms = 420) => {
    if (anim !== null) cancelAnimationFrame(anim);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) ms = 0;
    const from = { ...view };
    const t0 = performance.now();
    const tick = (/** @type {number} */ now) => {
      const t = ms === 0 ? 1 : Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      view.k = from.k + (to.k - from.k) * e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      apply();
      anim = t < 1 ? requestAnimationFrame(tick) : null;
    };
    anim = requestAnimationFrame(tick);
  };

  /**
   * The view that shows a map rectangle within the visible area.
   *
   * @param {Rect} r The rectangle, in map units.
   * @param {number} [maxK] The largest zoom to use.
   * @returns {{ k: number; x: number; y: number }} The view.
   */
  const viewFor = (r, maxK = 1.1) => {
    const ins = events.insets();
    const w = host.clientWidth - ins.left - ins.right;
    const h = host.clientHeight - ins.top - ins.bottom;
    const k = clampK(Math.min(w / r.w, h / r.h, maxK));
    return {
      k,
      x: ins.left + (w - r.w * k) / 2 - r.x * k,
      y: ins.top + (h - r.h * k) / 2 - r.y * k,
    };
  };

  /** Shows the whole map. */
  const fit = (animate = true) => {
    const v = viewFor(
      { x: -10, y: -10, w: m.size.w + 20, h: m.size.h + 20 },
      1,
    );
    if (animate) animateTo(v);
    else {
      Object.assign(view, v);
      apply();
    }
  };

  /**
   * Zooms around a screen point.
   *
   * @param {number} factor The zoom factor.
   * @param {number} [sx] Screen x within the host (default: centre).
   * @param {number} [sy] Screen y within the host.
   */
  const zoomAt = (
    factor,
    sx = host.clientWidth / 2,
    sy = host.clientHeight / 2,
  ) => {
    const k = clampK(view.k * factor);
    const f = k / view.k;
    view.x = sx - (sx - view.x) * f;
    view.y = sy - (sy - view.y) * f;
    view.k = k;
    apply();
  };

  /** @type {Map<number, { x: number; y: number }>} */ const pointers =
    new Map();
  let start = { x: 0, y: 0, vx: 0, vy: 0, dist: 0, k: 1 };

  host.addEventListener("pointerdown", ev => {
    if (ev.button !== 0) return;
    stopAnim();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    moved = false;
    if (pointers.size === 1)
      start = {
        x: ev.clientX,
        y: ev.clientY,
        vx: view.x,
        vy: view.y,
        dist: 0,
        k: view.k,
      };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      start = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        vx: view.x,
        vy: view.y,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        k: view.k,
      };
    }
  });
  host.addEventListener("pointermove", ev => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) host.setPointerCapture(ev.pointerId);
      moved = true;
      host.classList.add("is-panning");
      view.x = start.vx + dx;
      view.y = start.vy + dy;
      apply();
    } else if (pointers.size === 2) {
      moved = true;
      const [a, b] = [...pointers.values()];
      const box = host.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - box.left;
      const cy = (a.y + b.y) / 2 - box.top;
      const k = clampK(
        start.k * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist),
      );
      const f = k / start.k;
      const sx = start.x - box.left;
      const sy = start.y - box.top;
      view.k = k;
      view.x = cx - (sx - start.vx) * f;
      view.y = cy - (sy - start.vy) * f;
      apply();
    }
  });
  const release = (/** @type {PointerEvent} */ ev) => {
    pointers.delete(ev.pointerId);
    host.classList.remove("is-panning");
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      start = { x: p.x, y: p.y, vx: view.x, vy: view.y, dist: 0, k: view.k };
    }
  };
  host.addEventListener("pointerup", release);
  host.addEventListener("pointercancel", release);
  root.addEventListener("click", () => {
    if (!moved) events.onBackground();
  });
  host.addEventListener(
    "wheel",
    ev => {
      ev.preventDefault();
      stopAnim();
      const box = host.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(
          Math.exp(-ev.deltaY * 0.01),
          ev.clientX - box.left,
          ev.clientY - box.top,
        );
      } else {
        const scale = ev.deltaMode === 1 ? 16 : 1;
        view.x -= ev.deltaX * scale;
        view.y -= ev.deltaY * scale;
        apply();
      }
    },
    { passive: false },
  );

  fit(false);
  refresh();

  return {
    /** @param {string | null} id */
    selectNode(id) {
      state.node = id;
      state.edge = null;
      refresh();
    },
    /** @param {string | null} id */
    selectEdge(id) {
      state.edge = id;
      state.node = null;
      refresh();
    },
    /**
     * @param {string | null} id Lights one edge, from the panel's connection
     *   list.
     */
    previewEdge(id) {
      for (const [eid, el] of edgeEls)
        el.classList.toggle("is-preview", eid === id);
    },
    /** @param {Status | null} status */
    filterStatus(status) {
      state.status = status;
      refresh();
    },
    /** @param {Journey | null} journey @param {number} step */
    setJourney(journey, step) {
      state.journey = journey;
      state.step = step;
      drawJourney();
      refresh();
    },
    /** Pans and zooms to a node. @param {string} id */
    focusNode(id) {
      const n = nodeOf(m, id);
      if (!n) return;
      const r = rectOf(n);
      const ins = events.insets();
      const k = Math.max(view.k, 0.85);
      const cx = ins.left + (host.clientWidth - ins.left - ins.right) / 2;
      const cy = ins.top + (host.clientHeight - ins.top - ins.bottom) / 2;
      animateTo({
        k,
        x: cx - (r.x + r.w / 2) * k,
        y: cy - (r.y + r.h / 2) * k,
      });
    },
    /** Pans and zooms to show nodes together. @param {string[]} ids */
    focusNodes(ids) {
      const rs = ids
        .map(id => nodeOf(m, id))
        .filter(Boolean)
        .map(n => rectOf(/** @type {MapNode} */ (n)));
      if (rs.length === 0) return;
      const x0 = Math.min(...rs.map(r => r.x)) - 90;
      const y0 = Math.min(...rs.map(r => r.y)) - 90;
      const x1 = Math.max(...rs.map(r => r.x + r.w)) + 90;
      const y1 = Math.max(...rs.map(r => r.y + r.h)) + 90;
      animateTo(viewFor({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 1.05));
    },
    fit,
    /** @param {number} f */
    zoomBy(f) {
      zoomAt(f);
    },
  };
};

/**
 * Shortens titles and subtitles that overflow their card, with an ellipsis, and
 * sizes each repo chip to its text. Needs the SVG in the document.
 *
 * @param {MapData} m The map.
 * @param {ReadonlyMap<string, SVGElement>} nodeEls The cards, by node id.
 */
const fitText = (m, nodeEls) => {
  for (const n of m.nodes) {
    const el = nodeEls.get(n.id);
    if (!el) continue;
    const max = (n.w ?? NODE_W) - 34;
    for (const t of el.querySelectorAll("text.node-title, text.node-sub")) {
      const text = /** @type {SVGTextElement} */ (t);
      const full = text.textContent ?? "";
      if (text.getComputedTextLength() <= max) continue;
      let s = full;
      while (s.length > 1 && text.getComputedTextLength() > max) {
        s = s.slice(0, -1);
        text.textContent = s.trimEnd() + "…";
      }
      text.append(svg("title", {}, [full]));
    }
    const label = /** @type {SVGTextElement | null} */ (
      el.querySelector(".chip text")
    );
    const box = el.querySelector(".chip rect");
    if (label && box) {
      const w = label.getComputedTextLength() + 14;
      const x = (n.w ?? NODE_W) - w - 12;
      box.setAttribute("width", String(w));
      box.setAttribute("x", String(x));
      label.setAttribute("x", String(x + w / 2));
    }
  }
};

/**
 * Sizes each edge tag's background to its text. Needs the SVG in the document.
 *
 * @param {SVGElement} layer The layer holding the tags.
 */
const sizeTags = layer => {
  for (const g of layer.children) {
    const text = /** @type {SVGTextElement | null} */ (g.querySelector("text"));
    const rect = g.querySelector("rect");
    if (!text || !rect) continue;
    const w = text.getComputedTextLength() + 16;
    rect.setAttribute("x", String(-w / 2));
    rect.setAttribute("width", String(w));
  }
};

/**
 * Draws one card.
 *
 * @param {MapNode} n The node.
 * @param {import("./data/types.js").Tone} tone Its colour.
 * @returns {SVGElement} Its group.
 */
const drawNode = (n, tone) => {
  const r = rectOf(n);
  const g = svg("g", {
    class: `node tone-${tone} status-${n.status}`,
    transform: `translate(${r.x},${r.y})`,
    tabindex: 0,
    role: "button",
    "data-id": n.id,
    "aria-label": `${n.title}: ${plain(n.sub)}`,
  });
  const body = svg("g", { class: "node-body" });
  body.append(
    svg("rect", {
      class: "node-glow",
      x: -5,
      y: -5,
      width: r.w + 10,
      height: r.h + 10,
      rx: 17,
    }),
    svg("rect", { class: "node-bg", width: r.w, height: r.h, rx: 13 }),
    svg("rect", {
      class: "node-accent",
      x: 9,
      y: 16,
      width: 3.5,
      height: r.h - 32,
      rx: 1.75,
    }),
    svg("text", { class: "node-title", x: 24, y: 31 }, [n.title]),
    svg("text", { class: "node-sub", x: 24, y: 51 }, [plain(n.sub)]),
    svg("circle", { class: "node-status", cx: r.w - 15, cy: r.h - 15, r: 4 }),
  );
  if (n.pkg) {
    // The chip widens with the package name (≈ 6.6 units per mono character).
    const w = Math.round(n.pkg.length * 6.6 + 16);
    body.append(
      svg("g", { class: "chip pkg" }, [
        svg("rect", { x: r.w - 12 - w, y: -9, width: w, height: 18, rx: 9 }),
        svg(
          "text",
          { x: r.w - 12 - w / 2, y: 0, dy: "0.35em", "text-anchor": "middle" },
          [n.pkg],
        ),
      ]),
    );
  }
  g.append(body);
  return g;
};

/**
 * An edge label pill.
 *
 * @param {{ x: number; y: number }} p Where its centre sits.
 * @param {string} text The label.
 * @param {string} cls Its classes.
 * @returns {SVGElement} The tag.
 */
const tag = (p, text, cls) =>
  svg("g", { class: cls, transform: `translate(${p.x},${p.y})` }, [
    svg("rect", { x: -40, y: -12, width: 80, height: 24, rx: 12 }),
    svg("text", { "text-anchor": "middle", dy: "0.35em" }, [text]),
  ]);

/**
 * Arrowhead markers, one per edge kind and two for journeys.
 *
 * @returns {SVGElement} The `<defs>`.
 */
const defs = () => {
  const kinds = [
    "net",
    "local",
    "message",
    "process",
    "mcp",
    "file",
    "human",
    "event",
    "git",
    "journey",
    "journey-current",
  ];
  return svg(
    "defs",
    {},
    kinds.map(k =>
      svg(
        "marker",
        {
          id: `arr-${k}`,
          viewBox: "0 0 10 10",
          refX: 8.5,
          refY: 5,
          markerWidth: k.startsWith("journey") ? 13 : 9,
          markerHeight: k.startsWith("journey") ? 13 : 9,
          markerUnits: "userSpaceOnUse",
          orient: "auto-start-reverse",
        },
        [
          svg("path", {
            class: `arrow arrow-${k}`,
            d: "M1,1.2 L9,5 L1,8.8 Q2.6,5 1,1.2 Z",
          }),
        ],
      ),
    ),
  );
};
