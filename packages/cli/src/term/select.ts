/**
 * @file The select prompt: a list of options moved with ↑/↓ (or `j`/`k`),
 *   Home/End and `1`–`9`, chosen with Enter. `n` adds a note (one line, edited
 *   in place), `d` shows or hides the details (a document), `q` or Esc leaves
 *   the question for later, Ctrl-C stops. It redraws only its own lines,
 *   follows a resize, and collapses to one line once answered. Plain mode
 *   prints the options as `1) label (id) - description` and asks `Choose [n]:
 *   `, as `ork decide` always did; there a note is asked for after the choice
 *   when the prompt takes one, and `q` or an ended input leaves the question
 *   for later where it may wait.
 */

import { barred } from "./card-bar.ts";
import { fitSelect } from "./fit.ts";
import { readKeys } from "./keys.ts";
import { cut, widthOf, wrap } from "./layout.ts";
import { interrupt, readLine, withdrawn } from "./line.ts";
import { canKey, type PromptIO, type Term, termOf } from "./mode.ts";
import {
  asIs,
  type Look,
  nameOf,
  pickOption,
  plainOptions,
  type SelectOption,
} from "./option-name.ts";
import { createRegion } from "./screen.ts";
import { type LineState, editLine, readText, showLine } from "./text.ts";
import { apply, paint } from "./theme.ts";

export { plainOptions, type SelectOption };

export type SelectResult =
  | { kind: "chosen"; id: string; note?: string }
  /** `q` or Esc: the question stays open for later. */
  | { kind: "later" }
  /** Ctrl-C, after the terminal was restored. */
  | { kind: "interrupted" };

export type SelectOptions = {
  /** The lines above the options (the card), laid out for the width given. */
  header?: (term: Term) => string[];
  options: readonly SelectOption[];
  /** Lines a plain prompt prints after the options, just above `Choose`. */
  footer?: readonly string[];
  /** The option's id to mark `(recommended)` and to start on. */
  recommended?: string;
  /** What `d` shows: the full context or a document. */
  details?: string;
  /** Takes a note: `n` on a terminal, a line after the choice when plain. */
  note?: boolean;
  /** What a plain prompt asks for the note; today's `ork decide` wording. */
  notePrompt?: string;
  /** Whether `q` and Esc leave the question for later. */
  later?: boolean;
  /** The line left behind once answered; the choice's label by default. */
  done?: (
    result: Exclude<SelectResult, { kind: "interrupted" }>,
    term: Term,
  ) => string;
  /** A withdrawn prompt rejects with the signal's reason. */
  signal?: AbortSignal;
};

const NOTE_PROMPT = "Note for the run (optional, Enter to skip)";

const defaultDone =
  (options: readonly SelectOption[]) =>
  (
    result: Exclude<SelectResult, { kind: "interrupted" }>,
    term: Term,
  ): string => {
    if (result.kind === "later") {
      return ` ${paint(term, "muted", "·")} left for later`;
    }
    const option = options.find(o => o.id === result.id);
    const name =
      option === undefined
        ? cut(result.id, term.width - 3)
        : nameOf(term, option, term.width - 3);
    return ` ${paint(term, "ok", "✓")} ${name}`;
  };

/** The plain prompt: numbered options, then `Choose [n]: ` until one fits. */
const selectPlain = (io: PromptIO, o: SelectOptions): Promise<SelectResult> => {
  const term = termOf(io.output, io.env);
  const say = (text: string): void => {
    io.output.write(`${text}\n`);
  };
  for (const line of o.header?.(term) ?? []) say(line);
  for (const line of plainOptions(o.options, o.recommended)) say(line);
  for (const line of o.footer ?? []) say(line);
  const at = o.options.findIndex(opt => opt.id === o.recommended);
  const hint = at === -1 ? "" : ` [${String(at + 1)}]`;
  const ask = async (): Promise<SelectResult> => {
    const answer = await readLine(io, `  Choose${hint}: `, o.signal);
    // Where it may wait, an ended input leaves it open, as `q` does.
    if (answer === undefined) {
      if (o.later === true) return { kind: "later" };
      throw new Error("input ended");
    }
    // Picked first, so an option named `d` or `q` wins over what they do.
    const id = pickOption(answer, o.options, o.recommended);
    if (id === undefined && o.later === true && answer.trim() === "q") {
      return { kind: "later" };
    }
    if (id === undefined) {
      if (o.details !== undefined && answer.trim() === "d") say(o.details);
      else say("  Type an option's number or id.");
      return ask();
    }
    if (o.note !== true) return { kind: "chosen", id };
    const noted = await readText(io, {
      message: o.notePrompt ?? NOTE_PROMPT,
      ...(o.signal === undefined ? {} : { signal: o.signal }),
    });
    return noted.kind === "text" && noted.value !== ""
      ? { kind: "chosen", id, note: noted.value }
      : { kind: "chosen", id };
  };
  return ask();
};

/** Asks for one of `options`. */
export const select = (
  io: PromptIO,
  o: SelectOptions,
): Promise<SelectResult> => {
  if (o.signal?.aborted === true) return Promise.reject(withdrawn(o.signal));
  if (!canKey(io.input, io.output, io.env)) return selectPlain(io, o);
  const term = () => termOf(io.output, io.env);
  const region = createRegion(io.output, term);
  const done = o.done ?? defaultDone(o.options);
  return new Promise<SelectResult>((resolve, reject) => {
    const start = o.options.findIndex(opt => opt.id === o.recommended);
    let cursor = Math.max(0, start);
    let showDetails = false;
    let note: string | undefined;
    let editing: LineState | undefined;

    /**
     * Each option's lines; `compact`, only the chosen one keeps its
     * description, for a terminal too short for them all.
     */
    const optionBlocks = (t: Term, compact: boolean): string[][] =>
      o.options.map((option, i) => {
        const selected = i === cursor;
        const number = i < 9 ? `${String(i + 1)}.` : "  ";
        const mark = option.id === o.recommended ? " (recommended)" : "";
        const look: Look = selected
          ? text => apply(t, ["bold", "cyan"], text)
          : asIs;
        const room = t.width - 4 - mark.length;
        const prefix = cut(`${number} `, room);
        const text = `${look(prefix)}${nameOf(
          t,
          option,
          room - widthOf(prefix),
          look,
        )}`;
        const pointer = selected ? paint(t, "accent", "❯") : " ";
        const lines = [
          ` ${pointer} ${text}${mark === "" ? "" : paint(t, "ok", mark)}`,
        ];
        if (compact && !selected) return lines;
        for (const line of wrap(option.description ?? "", t.width - 7)) {
          if (line !== "") lines.push(paint(t, "muted", `      ${line}`));
        }
        return lines;
      });

    const keyLine = (t: Term): string => {
      const keys =
        editing === undefined
          ? [
              "↑/↓ move",
              "Enter choose",
              ...(o.note === true ? ["n note"] : []),
              ...(o.details === undefined
                ? []
                : [`d ${showDetails ? "hide" : "show"} details`]),
              ...(o.later === true ? ["q later"] : []),
            ]
          : ["Enter save", "Esc cancel"];
      return paint(t, "muted", cut(` ${keys.join(" · ")}`, t.width));
    };

    /**
     * The card, options, note, details and key line, in the rows the terminal
     * has: when they don't fit, only the chosen option keeps its description,
     * the options show as a window around it, and the card is cut.
     */
    const render = (): void => {
      const t = term();
      const muted = (text: string): string => paint(t, "muted", text);
      const noteLine =
        note === undefined ? [] : [muted(cut(` note: ${note}`, t.width))];
      const { head, body, detail } = fitSelect(t, {
        head: o.header?.(t) ?? [],
        blocks: compact => optionBlocks(t, compact),
        cursor,
        details:
          showDetails && o.details !== undefined
            ? wrap(o.details.trimEnd(), t.width - 3)
            : [],
        hasDetails: o.details !== undefined,
        tail: noteLine.length + 1 + (editing === undefined ? 0 : 1),
        muted,
      });
      const lines = [...head, ...body, ...noteLine, ...detail, keyLine(t)];
      if (editing === undefined) {
        region.draw(barred(t, lines));
        return;
      }
      const lead = ` ${paint(t, "accent", "✎")} Note › `;
      const { line, column } = showLine(lead, editing, t.width, 10);
      region.draw(barred(t, [...lines, line]), column);
    };

    const finish = (
      result: Exclude<SelectResult, { kind: "interrupted" }>,
    ): void => {
      stop();
      cleanup();
      region.finish(done(result, term()));
      resolve(result);
    };
    const cleanup = (): void => {
      io.output.off("resize", render);
      o.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      stop();
      cleanup();
      region.finish();
      reject(withdrawn(o.signal));
    };

    const edit = (key: Parameters<typeof editLine>[1]): void => {
      if (editing === undefined) return;
      if (key.name === "enter") {
        const value = editing.value.trim();
        note = value === "" ? undefined : value;
        editing = undefined;
      } else if (key.name === "escape") editing = undefined;
      else editing = editLine(editing, key);
      render();
    };
    const move = (to: number): void => {
      cursor = Math.min(o.options.length - 1, Math.max(0, to));
      render();
    };
    const stop = readKeys(io.input, key => {
      if (key.name === "ctrl-c") {
        stop();
        cleanup();
        region.finish();
        resolve({ kind: "interrupted" });
        interrupt(io);
      } else if (editing !== undefined) edit(key);
      else if (key.name === "enter") {
        const id = o.options[cursor]?.id;
        if (id === undefined) return;
        finish(
          note === undefined
            ? { kind: "chosen", id }
            : { kind: "chosen", id, note },
        );
      } else if (key.name === "up") move(cursor - 1);
      else if (key.name === "down") move(cursor + 1);
      else if (key.name === "home") move(0);
      else if (key.name === "end") move(o.options.length - 1);
      else if (key.name === "escape" && o.later === true)
        finish({ kind: "later" });
      else if (key.name === "char") {
        const c = key.text;
        if (c === "k") move(cursor - 1);
        else if (c === "j") move(cursor + 1);
        else if (c >= "1" && c <= "9") {
          if (Number(c) <= o.options.length) move(Number(c) - 1);
        } else if (c === "n" && o.note === true) {
          const value = note ?? "";
          editing = { value, pos: Array.from(value).length };
          render();
        } else if (c === "d" && o.details !== undefined) {
          showDetails = !showDetails;
          render();
        } else if (c === "q" && o.later === true) finish({ kind: "later" });
      }
    });
    io.output.on("resize", render);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    render();
  });
};
