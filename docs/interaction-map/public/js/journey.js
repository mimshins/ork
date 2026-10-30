/**
 * @file The journey stepper: the card that walks through a journey's steps,
 *   with previous / next, autoplay, and a list of every step.
 */

import { docUrl } from "./lib/docs.js";
import { esc, rich } from "./lib/dom.js";
import { nodeOf, toneOf } from "./model.js";
import { STATUS_LABEL } from "./panel.js";

/** @typedef {import("./data/types.js").MapData} MapData */
/** @typedef {import("./data/types.js").Journey} Journey */

/**
 * The stepper's HTML for one step.
 *
 * @param {MapData} m The map.
 * @param {Journey} j The journey.
 * @param {number} i The step's index.
 * @param {boolean} playing Whether autoplay is on.
 * @param {boolean} listOpen Whether the step list is shown.
 * @returns {string} The HTML.
 */
export const stepperHtml = (m, j, i, playing, listOpen) => {
  const s = j.steps[i];
  const from = nodeOf(m, s.from);
  const to = s.to ? nodeOf(m, s.to) : undefined;
  const n = j.steps.length;
  return `
    <div class="stepper-head">
      <div>
        <div class="eyebrow">${esc(j.who)} · journey</div>
        <h2>${esc(j.title)}</h2>
      </div>
      <button class="icon-btn" data-act="close" aria-label="Close the journey" title="Close (Esc)">
        <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </div>
    <div class="progress" role="list" aria-label="Steps">${j.steps
      .map(
        (_, k) =>
          `<button role="listitem" class="seg${k < i ? " is-past" : k === i ? " is-current" : ""}" data-step="${k}" aria-label="Step ${k + 1}"></button>`,
      )
      .join("")}</div>
    <div class="step">
      <div class="step-meta">
        <span class="step-no">Step ${i + 1} <small>of ${n}</small></span>
        ${s.status ? `<span class="mini status-${s.status}">${STATUS_LABEL[s.status]}</span>` : ""}
        <span class="route small">
          <button class="node-link tone-${toneOf(m, from)}" data-node="${s.from}">${esc(from?.title ?? s.from)}</button>
          ${to ? `<span class="route-arrow" aria-hidden="true">→</span><button class="node-link tone-${toneOf(m, to)}" data-node="${to.id}">${esc(to.title)}</button>` : ""}
        </span>
      </div>
      <h3>${rich(s.title)}</h3>
      <p>${rich(s.detail)}</p>
      ${
        s.docs?.length
          ? `<div class="step-docs">${s.docs
              .map(
                ref =>
                  `<a href="${esc(docUrl(ref))}" target="_blank" rel="noopener noreferrer"><span class="repo repo-${ref.repo}"></span>${rich(ref.label)}</a>`,
              )
              .join("")}</div>`
          : ""
      }
    </div>
    <div class="stepper-foot">
      <button class="btn" data-act="list" aria-expanded="${listOpen}">${listOpen ? "Hide steps" : "All steps"}</button>
      <div class="controls">
        <button class="icon-btn" data-act="prev" aria-label="Previous step" title="Previous (←)" ${i === 0 ? "disabled" : ""}>
          <svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg>
        </button>
        <button class="icon-btn play" data-act="play" aria-label="${playing ? "Pause" : "Play"}" title="${playing ? "Pause" : "Play"} (Space)">
          ${playing ? '<svg viewBox="0 0 16 16"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>' : '<svg viewBox="0 0 16 16"><path class="fill" d="M5 3.2v9.6L12.6 8z"/></svg>'}
        </button>
        <button class="icon-btn" data-act="next" aria-label="Next step" title="Next (→)" ${i === n - 1 ? "disabled" : ""}>
          <svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
        </button>
      </div>
    </div>
    ${
      listOpen
        ? `<ol class="step-list">${j.steps
            .map(
              (st, k) =>
                `<li><button data-step="${k}" class="${k === i ? "is-current" : ""}"><span>${k + 1}</span>${rich(st.title)}${
                  st.status
                    ? `<em class="mini status-${st.status}">${STATUS_LABEL[st.status]}</em>`
                    : ""
                }</button></li>`,
            )
            .join("")}</ol>`
        : ""
    }`;
};

/**
 * The journey picker's HTML.
 *
 * @param {MapData} m The map.
 * @param {string | null} activeId The open journey, if any.
 * @returns {string} The HTML.
 */
export const pickerHtml = (m, activeId) =>
  m.journeys.length === 0
    ? `<p class="journey-empty">No journeys on this map yet.</p>`
    : m.journeys
        .map(
          j => `<button role="menuitem" class="journey-item${j.id === activeId ? " is-active" : ""}" data-journey="${j.id}">
      <span class="ji-title">${esc(j.title)}<small>${j.steps.length} steps</small></span>
      <span class="ji-who">${esc(j.who)}</span>
      <span class="ji-sum">${rich(j.summary)}</span>
    </button>`,
        )
        .join("");
