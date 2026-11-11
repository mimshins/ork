/**
 * @file A fake terminal for the kit's tests: an input that takes the bytes a
 *   key sends, and an output that follows the cursor moves and clears the kit
 *   uses, so a test reads the screen as a person would, with the styles left
 *   out. `escapes` keeps what was written raw.
 */

import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import type { PromptIO } from "../src/term/mode.ts";

/** What a test reads of a fake terminal. */
export type FakeTerm = {
  io: PromptIO;
  /** The screen's lines, trailing blanks dropped. */
  screen: () => string[];
  /** Every byte written, escape codes included. */
  raw: () => string;
  /** Whether the cursor is hidden now. */
  hidden: () => boolean;
  /** Whether raw mode is on now. */
  rawMode: () => boolean;
  /** Sends keys (each a string of bytes), a turn apart. */
  press: (...keys: string[]) => Promise<void>;
  /** Changes the width and tells the output, as a terminal does. */
  resize: (columns: number) => void;
  interrupted: () => number;
  /** Ends the input, as Ctrl-D or a closed pipe does. */
  end: () => void;
};

export const KEY = {
  up: "\u001B[A",
  down: "\u001B[B",
  right: "\u001B[C",
  left: "\u001B[D",
  home: "\u001B[H",
  end: "\u001B[F",
  enter: "\r",
  esc: "\u001B",
  backspace: "\u007F",
  ctrlC: "\u0003",
} as const;

const turn = (): Promise<void> =>
  new Promise(done => {
    setImmediate(done);
  });

export type FakeOptions = {
  /** Whether both streams are terminals; true by default. */
  tty?: boolean;
  columns?: number;
  rows?: number;
  /** Whether the input has raw mode (a terminal's does); true by default. */
  rawMode?: boolean;
  env?: NodeJS.ProcessEnv;
};

/** A fake terminal, or a plain pair of pipes when `tty` is false. */
export const fakeTerm = (options: FakeOptions = {}): FakeTerm => {
  const tty = options.tty ?? true;
  let raw = "";
  let rows: string[] = [""];
  let row = 0;
  let col = 0;
  let hidden = false;
  let rawMode = false;
  let interrupts = 0;
  const put = (char: string): void => {
    const line = rows[row] ?? "";
    rows[row] =
      line.padEnd(col, " ").slice(0, col) + char + line.slice(col + 1);
    col += 1;
  };
  const csi = (params: string, final: string): void => {
    const n = Number(params) || 1;
    if (params === "?25" && final === "l") hidden = true;
    else if (params === "?25" && final === "h") hidden = false;
    else if (final === "A") row = Math.max(0, row - n);
    else if (final === "C") col += n;
    else if (final === "G") col = n - 1;
    else if (final === "J") {
      rows = rows.slice(0, row + 1);
      rows[row] = (rows[row] ?? "").slice(0, col);
    }
  };
  const text = (chars: string): void => {
    for (const char of chars) {
      if (char === "\n") {
        row += 1;
        col = 0;
        rows[row] ??= "";
      } else if (char === "\r") col = 0;
      else put(char);
    }
  };
  const write = (chunk: string): void => {
    raw += chunk;
    const [first = "", ...escaped] = chunk.split("\u001B");
    text(first);
    for (const segment of escaped) {
      const found = /^\[([0-9;?]*)([A-Za-z])/u.exec(segment);
      if (found === null) text(segment);
      else {
        csi(found[1] ?? "", found[2] ?? "");
        text(segment.slice(found[0].length));
      }
    }
  };
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        write(String(chunk));
        done();
      },
    }),
    { isTTY: tty, columns: options.columns ?? 40, rows: options.rows ?? 24 },
  );
  const input = Object.assign(new PassThrough(), {
    isTTY: tty,
    isRaw: false,
    setRawMode: (mode: boolean): void => {
      rawMode = mode;
    },
  });
  if (options.rawMode === false) Reflect.deleteProperty(input, "setRawMode");
  const sendAll = async (keys: readonly string[]): Promise<void> => {
    const [key, ...rest] = keys;
    if (key === undefined) {
      await turn();
      return;
    }
    input.write(key);
    await turn();
    await turn();
    await sendAll(rest);
  };
  return {
    io: {
      input,
      output,
      env: options.env ?? {},
      interrupt: () => {
        interrupts += 1;
      },
    },
    screen: () =>
      rows
        .map(line => stripVTControlCharacters(line).trimEnd())
        .filter((line, i, all) => line !== "" || i < all.length - 1),
    raw: () => raw,
    hidden: () => hidden,
    rawMode: () => rawMode,
    press: (...keys) => sendAll(keys),
    resize: columns => {
      output.columns = columns;
      output.emit("resize");
    },
    interrupted: () => interrupts,
    end: () => {
      input.end();
    },
  };
};
