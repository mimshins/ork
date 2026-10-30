/** @file Small DOM helpers: queries, escaping, element builders. */

/** The SVG namespace. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Finds one element, or throws: every element the scripts look up is in the
 * page's markup.
 *
 * @template {Element} T
 * @param {string} selector A CSS selector.
 * @param {ParentNode} [root] Where to look.
 * @returns {T} The element.
 */
export const $ = (selector, root = document) => {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return /** @type {T} */ (el);
};

/**
 * Escapes text for HTML.
 *
 * @param {string} s The text.
 * @returns {string} The escaped text.
 */
export const esc = s =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

/**
 * Renders data text as HTML: escaped, with `code` in backticks.
 *
 * @param {string} s The text.
 * @returns {string} Safe HTML.
 */
export const rich = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/**
 * Strips the backticks from data text, for plain-text places (SVG, titles).
 *
 * @param {string} s The text.
 * @returns {string} Plain text.
 */
export const plain = s => s.replace(/`/g, "");

/**
 * Creates an SVG element with attributes.
 *
 * @param {string} tag The tag name.
 * @param {Record<string, string | number>} [attrs] Attributes.
 * @param {ReadonlyArray<Element | string>} [children] Children; strings become
 *   text.
 * @returns {SVGElement} The element.
 */
export const svg = (tag, attrs = {}, children = []) => {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
};
