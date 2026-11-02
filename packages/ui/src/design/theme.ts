/**
 * @file The page's look: which theme (dark or light) and contrast (standard or
 *   more) the tokens use, set as `data-theme` and `data-contrast` on the root.
 *   The theme follows the system's setting until the user picks one; contrast
 *   follows `prefers-contrast: more`. Both update live when the system
 *   changes.
 */

export type Theme = "dark" | "light";
export type ThemeChoice = Theme | "system";
export type Contrast = "standard" | "more";
export type Look = { theme: Theme; contrast: Contrast };

/** The part of a media query list the look listens to. */
export type MediaWatch = {
  readonly matches: boolean;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
};

/** The part of a window the look reads: a real `window` is one. */
export type View = {
  document: Document;
  matchMedia: (query: string) => MediaWatch;
};

const PREFERS_LIGHT = "(prefers-color-scheme: light)";
const PREFERS_MORE = "(prefers-contrast: more)";

/** The look for a choice, given which media queries match. */
export const lookOf = (
  choice: ThemeChoice,
  matches: (query: string) => boolean,
): Look => {
  const system: Theme = matches(PREFERS_LIGHT) ? "light" : "dark";
  return {
    theme: choice === "system" ? system : choice,
    contrast: matches(PREFERS_MORE) ? "more" : "standard",
  };
};

/** Sets a look on an element, the page's root by default. */
export const applyLook = (root: HTMLElement, look: Look): void => {
  root.dataset["theme"] = look.theme;
  root.dataset["contrast"] = look.contrast;
};

/**
 * Applies the look for `choice()` now and again whenever the system's color
 * scheme or contrast changes; returns the function that stops following.
 */
export const followSystem = (
  view: View,
  choice: () => ThemeChoice,
): (() => void) => {
  const queries = [PREFERS_LIGHT, PREFERS_MORE].map(q => view.matchMedia(q));
  const update = () => {
    applyLook(
      view.document.documentElement,
      lookOf(choice(), query => view.matchMedia(query).matches),
    );
  };
  update();
  for (const query of queries) query.addEventListener("change", update);
  return () => {
    for (const query of queries) query.removeEventListener("change", update);
  };
};
