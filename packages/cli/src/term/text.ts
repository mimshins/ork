/**
 * @file The text prompt: one line of text, edited in place on a terminal
 *   (arrows, Home/End, Backspace, Delete, Ctrl-U to clear), collapsing to one
 *   line when answered; Enter sends, Esc (or Ctrl-D on an empty line) leaves
 *   it. Plain mode asks `message: ` and reads a line, as the prompts always
 *   did. `editLine` is the editing itself, which the select prompt reuses for
 *   its note.
 */

import { type Key, readKeys } from "./keys.ts";
import { cut } from "./layout.ts";
import { interrupt, readLine, withdrawn } from "./line.ts";
import { canKey, type PromptIO, termOf } from "./mode.ts";
import { createRegion } from "./screen.ts";
import { bold, paint } from "./theme.ts";

/** A line being edited: its text and the cursor's place in it. */
export type LineState = { value: string; pos: number };

const at = (next: string[], to: number): LineState => ({
  value: next.join(""),
  pos: to,
});

/** `state` after `key`; keys that do not edit leave it as it is. */
export const editLine = (state: LineState, key: Key): LineState => {
  const { value, pos } = state;
  const chars = Array.from(value);
  if (key.name === "char") {
    return at(chars.toSpliced(pos, 0, key.text), pos + 1);
  }
  if (key.name === "backspace") {
    return pos === 0 ? state : at(chars.toSpliced(pos - 1, 1), pos - 1);
  }
  if (key.name === "delete") return at(chars.toSpliced(pos, 1), pos);
  if (key.name === "left") return { value, pos: Math.max(0, pos - 1) };
  if (key.name === "right") {
    return { value, pos: Math.min(chars.length, pos + 1) };
  }
  if (key.name === "home" || key.name === "ctrl-a") return { value, pos: 0 };
  if (key.name === "end" || key.name === "ctrl-e") {
    return { value, pos: chars.length };
  }
  if (key.name === "ctrl-u") return at(chars.slice(pos), 0);
  return state;
};

/**
 * The line to draw for `state` after `lead`, within `width`, and the column of
 * the cursor in it. A value too long for the room scrolls to keep the cursor in
 * view.
 */
export const showLine = (
  lead: string,
  state: LineState,
  width: number,
  leadWidth: number,
): { line: string; column: number } => {
  const chars = Array.from(state.value);
  const room = Math.max(1, width - leadWidth - 1);
  const start = Math.max(0, state.pos - room + 1);
  return {
    line: `${lead}${chars.slice(start, start + room).join("")}`,
    column: leadWidth + state.pos - start,
  };
};

export type TextOptions = {
  /** What is asked, without a colon: `Note for the run (optional)`. */
  message: string;
  /** The text to start with, for an edit. */
  initial?: string;
  /** The line left behind once answered; `undefined` leaves none. */
  done?: (value?: string) => string | undefined;
  /** A withdrawn prompt rejects with the signal's reason. */
  signal?: AbortSignal;
};

export type TextResult =
  | { kind: "text"; value: string }
  /** Esc, Ctrl-D, or the input ended: no answer, and the question stays open. */
  | { kind: "cancelled" }
  /** Ctrl-C, after the terminal was restored. */
  | { kind: "interrupted" };

const defaultDone =
  (io: PromptIO, message: string) =>
  (value?: string): string => {
    const term = termOf(io.output, io.env);
    const mark = paint(term, "ok", "✓");
    const text = value === undefined || value === "" ? "skipped" : value;
    return cut(` ${mark} ${message} · ${text}`, term.width);
  };

/** Asks for one line of text. */
export const readText = async (
  io: PromptIO,
  options: TextOptions,
): Promise<TextResult> => {
  const { message, signal } = options;
  if (signal?.aborted === true) throw withdrawn(signal);
  if (!canKey(io.input, io.output, io.env)) {
    const answer = await readLine(io, `  ${message}: `, signal);
    return answer === undefined
      ? { kind: "cancelled" }
      : { kind: "text", value: answer.trim() };
  }
  const done = options.done ?? defaultDone(io, message);
  const term = () => termOf(io.output, io.env);
  const region = createRegion(io.output, term);
  const initial = options.initial ?? "";
  return new Promise<TextResult>((resolve, reject) => {
    let state: LineState = { value: initial, pos: Array.from(initial).length };
    const lead = ` ${paint(term(), "accent", "?")} ${bold(term(), message)} › `;
    const leadWidth = Array.from(` ? ${message} › `).length;
    const render = (): void => {
      const { line, column } = showLine(lead, state, term().width, leadWidth);
      region.draw([line], column);
    };
    const finish = (result: TextResult, line?: string): void => {
      stop();
      io.output.off("resize", render);
      signal?.removeEventListener("abort", onAbort);
      region.finish(line);
      resolve(result);
    };
    const onAbort = (): void => {
      stop();
      io.output.off("resize", render);
      region.finish();
      reject(withdrawn(signal));
    };
    const stop = readKeys(io.input, key => {
      if (key.name === "enter") {
        const value = state.value.trim();
        finish({ kind: "text", value }, done(value));
      } else if (
        key.name === "escape" ||
        (key.name === "ctrl-d" && state.value === "")
      ) {
        finish({ kind: "cancelled" }, done());
      } else if (key.name === "ctrl-c") {
        finish({ kind: "interrupted" });
        interrupt(io);
      } else {
        state = editLine(state, key);
        render();
      }
    });
    io.output.on("resize", render);
    signal?.addEventListener("abort", onAbort, { once: true });
    render();
  });
};
