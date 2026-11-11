/**
 * @file Keys for the kit's prompts: a parser from the bytes a terminal sends in
 *   raw mode to named keys, and a reader that puts the input in raw mode for as
 *   long as a prompt is open. A lone Esc is a chunk that is only Esc, so it
 *   needs no timeout. The caller closes or pauses any `readline` on the same
 *   input first, since both would read the keys.
 */

import type { KeyStream } from "./mode.ts";

/** A key a prompt acts on; a printable character has `name: "char"`. */
export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "enter"
  | "escape"
  | "backspace"
  | "delete"
  | "ctrl-c"
  | "ctrl-d"
  | "ctrl-a"
  | "ctrl-e"
  | "ctrl-u";

export type Key = { name: KeyName } | { name: "char"; text: string };

/** What a `ESC [ …` or `ESC O …` sequence names. */
const SEQUENCES: Record<string, KeyName> = {
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[H": "home",
  "[F": "end",
  "[1~": "home",
  "[4~": "end",
  "[7~": "home",
  "[8~": "end",
  "[3~": "delete",
  OA: "up",
  OB: "down",
  OC: "right",
  OD: "left",
  OH: "home",
  OF: "end",
};

const CONTROLS: Record<string, KeyName> = {
  "\r": "enter",
  "\n": "enter",
  "\u007F": "backspace",
  "\b": "backspace",
  "\u0003": "ctrl-c",
  "\u0004": "ctrl-d",
  "\u0001": "ctrl-a",
  "\u0005": "ctrl-e",
  "\u0015": "ctrl-u",
};

/** The keys in one chunk of input; what it does not know it skips. */
export const parseKeys = (chunk: string): Key[] => {
  const keys: Key[] = [];
  const chars = Array.from(chunk);
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    if (char === "\u001B") {
      if (i === chars.length - 1) {
        keys.push({ name: "escape" });
        continue;
      }
      // `ESC [ …` runs to its final byte (a letter, or `~`); `ESC O x` is three.
      let end = i + (chars[i + 1] === "O" ? 3 : 2);
      while (
        chars[i + 1] === "[" &&
        end < chars.length + 1 &&
        !/[A-Za-z~]/u.test(chars[end - 1] ?? "")
      ) {
        end += 1;
      }
      const name = SEQUENCES[chars.slice(i + 1, end).join("")];
      if (name !== undefined) keys.push({ name });
      i = end - 1;
      continue;
    }
    const name = CONTROLS[char];
    if (name !== undefined) keys.push({ name });
    else if (char >= " ") keys.push({ name: "char", text: char });
  }
  return keys;
};

/**
 * Reads keys from `input` in raw mode, calling `onKey` for each, until the
 * returned function is called, which restores the mode and pauses the input.
 */
export const readKeys = (
  input: KeyStream,
  onKey: (key: Key) => void,
): (() => void) => {
  const wasRaw = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume();
  const onData = (chunk: Buffer | string): void => {
    for (const key of parseKeys(String(chunk))) onKey(key);
  };
  input.on("data", onData);
  return () => {
    input.off("data", onData);
    input.setRawMode?.(wasRaw);
    input.pause();
  };
};
