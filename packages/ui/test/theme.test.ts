/**
 * @file Tests for the page's look: the theme follows the system until the user
 *   picks one, contrast follows `prefers-contrast: more`, and both update on
 *   the root when the system changes, until the page stops following.
 */

import { describe, expect, it } from "vitest";

import { followSystem, lookOf, type View } from "../src/design/theme.ts";

/** A window whose media queries match `matching`, and can change. */
const fakeView = (matching: Set<string>) => {
  const listeners = new Set<() => void>();
  const view: View = {
    document,
    matchMedia: (query: string) => ({
      get matches() {
        return matching.has(query);
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    }),
  };
  const change = (query: string, on: boolean) => {
    matching[on ? "add" : "delete"](query);
    for (const listener of listeners) listener();
  };
  return { view, change, listeners };
};

const LIGHT = "(prefers-color-scheme: light)";
const MORE = "(prefers-contrast: more)";
const root = () => {
  const { dataset } = document.documentElement;
  return { theme: dataset["theme"], contrast: dataset["contrast"] };
};
const light = (query: string) => query === LIGHT;
const more = (query: string) => query === MORE;

describe("the look", () => {
  it("follows the system's theme until the user picks one", () => {
    expect(lookOf("system", light)).toEqual({
      theme: "light",
      contrast: "standard",
    });
    expect(lookOf("dark", light).theme).toBe("dark");
    expect(lookOf("system", () => false).theme).toBe("dark");
  });

  it("raises contrast when the system asks for more, in either theme", () => {
    expect(lookOf("light", more)).toEqual({ theme: "light", contrast: "more" });
  });

  it("sets the root's look now and whenever the system changes", () => {
    const { view, change, listeners } = fakeView(new Set());
    const stop = followSystem(view, () => "system");
    expect([root().theme, root().contrast]).toEqual(["dark", "standard"]);

    change(LIGHT, true);
    change(MORE, true);
    expect([root().theme, root().contrast]).toEqual(["light", "more"]);

    stop();
    expect(listeners.size).toBe(0);
  });

  it("keeps the user's pick when the system's theme changes", () => {
    const { view, change } = fakeView(new Set());
    const stop = followSystem(view, () => "dark");
    change(LIGHT, true);
    expect(root().theme).toBe("dark");
    stop();
  });
});
