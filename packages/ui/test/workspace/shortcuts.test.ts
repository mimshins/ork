/**
 * @file Tests for the workspace's key combinations: matching by physical key, ⌘
 *   on a Mac and Ctrl elsewhere, and how each is written down.
 */

import { describe, expect, it } from "vitest";

import {
  ariaKeysOf,
  isMac,
  keysOf,
  matches,
  SHORTCUTS,
} from "../../src/workspace/shortcuts.ts";

const press = (
  code: string,
  held: Partial<
    Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>
  > = {},
) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...held,
});

describe("shortcuts", () => {
  it("knows a Mac by its platform", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Linux x86_64")).toBe(false);
    expect(isMac("Win32")).toBe(false);
  });

  it("takes the palette's key as ⌘ on a Mac and Ctrl elsewhere", () => {
    const { palette } = SHORTCUTS;
    expect(matches(press("KeyK", { metaKey: true }), palette, true)).toBe(true);
    expect(matches(press("KeyK", { ctrlKey: true }), palette, true)).toBe(
      false,
    );
    expect(matches(press("KeyK", { ctrlKey: true }), palette, false)).toBe(
      true,
    );
    expect(matches(press("KeyK", { metaKey: true }), palette, false)).toBe(
      false,
    );
  });

  it("matches the physical key, with exactly the modifiers named", () => {
    const held = { altKey: true, shiftKey: true };
    expect(matches(press("KeyM", held), SHORTCUTS.minimize, false)).toBe(true);
    expect(matches(press("KeyM"), SHORTCUTS.minimize, false)).toBe(false);
    expect(
      matches(
        press("KeyM", { ...held, ctrlKey: true }),
        SHORTCUTS.minimize,
        false,
      ),
    ).toBe(false);
  });

  it("tells a move from a resize by the extra Ctrl", () => {
    const held = { altKey: true, shiftKey: true };
    const event = press("ArrowLeft", held);
    const moving = press("ArrowLeft", { ...held, ctrlKey: true });
    expect(matches(event, SHORTCUTS.resize("left"), false)).toBe(true);
    expect(matches(event, SHORTCUTS.move("left"), false)).toBe(false);
    expect(matches(moving, SHORTCUTS.move("left"), false)).toBe(true);
    expect(matches(moving, SHORTCUTS.resize("left"), false)).toBe(false);
  });

  it("writes a combination for the platform", () => {
    expect(keysOf(SHORTCUTS.palette, true)).toEqual(["⌘", "K"]);
    expect(keysOf(SHORTCUTS.palette, false)).toEqual(["Ctrl", "K"]);
    expect(keysOf(SHORTCUTS.move("up"), true)).toEqual(["⌃", "⌥", "⇧", "↑"]);
    expect(keysOf(SHORTCUTS.goTo(2), false)).toEqual(["Alt", "Shift", "2"]);
  });

  it("writes a combination for aria-keyshortcuts", () => {
    expect(ariaKeysOf(SHORTCUTS.palette, true)).toBe("Meta+K");
    expect(ariaKeysOf(SHORTCUTS.palette, false)).toBe("Control+K");
    expect(ariaKeysOf(SHORTCUTS.resize("left"), false)).toBe(
      "Alt+Shift+ArrowLeft",
    );
  });
});
