/**
 * @file Tests for the preferences: defaults, what a browser remembers, values
 *   that do not fit, and the page's look following them.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  createPreferences,
  DEFAULT_PREFERENCES,
  followPreferences,
} from "../../src/state/preferences.ts";
import { stubWindow } from "../dom.ts";

const KEY = "ork.preferences.v1";

const save = (value: unknown): void => {
  localStorage.setItem(KEY, JSON.stringify({ value, timestamp: 0 }));
};

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  stubWindow(false);
});

describe("the preferences", () => {
  it("start from the defaults", () => {
    expect(createPreferences(localStorage).value.getValue()).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it("are remembered", async () => {
    createPreferences(localStorage).update({ theme: "light" });
    await Promise.resolve();
    await Promise.resolve();
    expect(createPreferences(localStorage).value.getValue().theme).toBe(
      "light",
    );
  });

  it("fill in a field that was not saved", () => {
    save({ theme: "dark" });
    expect(createPreferences(localStorage).value.getValue()).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "dark",
    });
  });

  it("drop values that do not fit", () => {
    save({ theme: "neon" });
    expect(createPreferences(localStorage).value.getValue()).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it("set the page's look and keep it on the choice", () => {
    const preferences = createPreferences(localStorage);
    const stop = followPreferences(window, preferences);
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.dataset["density"]).toBe("compact");
    preferences.update({ theme: "light", density: "comfortable" });
    expect(root.dataset["theme"]).toBe("light");
    expect(root.dataset["density"]).toBe("comfortable");
    stop();
    preferences.update({ theme: "dark" });
    expect(root.dataset["theme"]).toBe("light");
  });
});
