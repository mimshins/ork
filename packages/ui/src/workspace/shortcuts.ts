/**
 * @file The workspace's key combinations: what each one is, whether a key event
 *   matches it, and how to write it down for the platform. A combination is
 *   matched by physical key (`KeyboardEvent.code`), because Option changes the
 *   character a key types on macOS.
 */

export type Shortcut = {
  /** The `KeyboardEvent.code` of the key. */
  code: string;
  /** What the key is called in text and in `aria-keyshortcuts`. */
  key: string;
  /** How the key is drawn, when that differs from its name: "←". */
  glyph?: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

type KeyState = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

export const isMac = (platform: string): boolean =>
  /mac|iphone|ipad/iu.test(platform);

export const matches = (
  event: KeyState,
  shortcut: Shortcut,
  mac: boolean,
): boolean => {
  const mod = shortcut.mod === true;
  return (
    event.code === shortcut.code &&
    event.altKey === (shortcut.alt === true) &&
    event.shiftKey === (shortcut.shift === true) &&
    event.metaKey === (mod && mac) &&
    event.ctrlKey === (shortcut.ctrl === true || (mod && !mac))
  );
};

/** The keys of a combination in the order they are held, one entry per key. */
export const keysOf = (shortcut: Shortcut, mac: boolean): string[] => {
  const key = shortcut.glyph ?? shortcut.key;
  return [
    ...(shortcut.ctrl === true ? [mac ? "⌃" : "Ctrl"] : []),
    ...(shortcut.mod === true ? [mac ? "⌘" : "Ctrl"] : []),
    ...(shortcut.alt === true ? [mac ? "⌥" : "Alt"] : []),
    ...(shortcut.shift === true ? [mac ? "⇧" : "Shift"] : []),
    key,
  ];
};

/** The combination as `aria-keyshortcuts` writes it. */
export const ariaKeysOf = (shortcut: Shortcut, mac: boolean): string =>
  [
    ...(shortcut.ctrl === true ? ["Control"] : []),
    ...(shortcut.mod === true ? [mac ? "Meta" : "Control"] : []),
    ...(shortcut.alt === true ? ["Alt"] : []),
    ...(shortcut.shift === true ? ["Shift"] : []),
    shortcut.key,
  ].join("+");

const panelKey = (code: string, key: string, glyph?: string): Shortcut => ({
  code,
  key,
  ...(glyph === undefined ? {} : { glyph }),
  alt: true,
  shift: true,
});

export type Direction = "left" | "right" | "up" | "down";

const ARROWS: Record<Direction, [string, string]> = {
  left: ["ArrowLeft", "←"],
  right: ["ArrowRight", "→"],
  up: ["ArrowUp", "↑"],
  down: ["ArrowDown", "↓"],
};

export const SHORTCUTS = {
  palette: { code: "KeyK", key: "K", mod: true },
  minimize: panelKey("KeyM", "M"),
  maximize: panelKey("KeyX", "X"),
  float: panelKey("KeyF", "F"),
  close: panelKey("KeyW", "W"),
  nextGroup: panelKey("BracketRight", "]"),
  previousGroup: panelKey("BracketLeft", "["),
  goTo: (position: number): Shortcut =>
    panelKey(`Digit${String(position)}`, String(position)),
  resize: (direction: Direction): Shortcut => {
    const [code, glyph] = ARROWS[direction];
    return panelKey(code, code, glyph);
  },
  move: (direction: Direction): Shortcut => {
    const [code, glyph] = ARROWS[direction];
    return { ...panelKey(code, code, glyph), ctrl: true };
  },
} as const satisfies Record<string, Shortcut | ((argument: never) => Shortcut)>;

/** The digits run out: a panel past the ninth has no Go to key of its own. */
const DIGITS = 9;

/** The Go to key of the panel at this place in the list, if it has one. */
export const goToShortcut = (position: number): Shortcut | undefined =>
  position <= DIGITS ? SHORTCUTS.goTo(position) : undefined;
