/**
 * @file The multiselect prompt: the select's list with a box on each option.
 *   ↑/↓ (or `j`/`k`), Home/End and `1`–`9` move, Space ticks or unticks, Enter
 *   confirms what is ticked (nothing is a valid answer), `q` or Esc leaves the
 *   question for later, Ctrl-C stops. It redraws only its own lines, follows a
 *   resize, and collapses to one line once answered. Plain mode prints the
 *   options as `1) label (id) - description` and asks `Choose [1,3]: `, where
 *   an empty line is none, and `q` or an ended input leaves the question for
 *   later where it may.
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
  nameLines,
  pickOption,
  plainOptions,
  type SelectOption,
} from "./option-name.ts";
import { createRegion } from "./screen.ts";
import { apply, paint } from "./theme.ts";

export type MultiselectResult =
  /** The ids ticked, in the options' order; empty when none. */
  | { kind: "chosen"; ids: string[] }
  /** `q` or Esc: the question stays open for later. */
  | { kind: "later" }
  /** Ctrl-C, after the terminal was restored. */
  | { kind: "interrupted" };

export type MultiselectOptions = {
  /** The lines above the options (the card), laid out for the width given. */
  header?: (term: Term) => string[];
  options: readonly SelectOption[];
  /** Lines a plain prompt prints after the options, just above `Choose`. */
  footer?: readonly string[];
  /** The ids ticked to start with. */
  initial?: readonly string[];
  /** Whether `q` and Esc leave the question for later. */
  later?: boolean;
  /** A withdrawn prompt rejects with the signal's reason. */
  signal?: AbortSignal;
};

type Settled = Exclude<MultiselectResult, { kind: "interrupted" }>;

/** The ids of `options` that `ticked` holds, in the options' order. */
const inOrder = (
  options: readonly SelectOption[],
  ticked: ReadonlySet<string>,
): string[] => options.map(o => o.id).filter(id => ticked.has(id));

/**
 * The options a plain answer names: numbers and ids split by commas or spaces;
 * `undefined` when a word names none.
 */
const pickMany = (
  answer: string,
  options: readonly SelectOption[],
): string[] | undefined => {
  const ids = new Set<string>();
  for (const word of answer.split(/[\s,]+/u).filter(w => w !== "")) {
    const id = pickOption(word, options, "");
    if (id === undefined) return undefined;
    ids.add(id);
  }
  return inOrder(options, ids);
};

const doneLine = (
  options: readonly SelectOption[],
  result: Settled,
  term: Term,
): string => {
  if (result.kind === "later") {
    return ` ${paint(term, "muted", "·")} left for later`;
  }
  if (result.ids.length === 0) return ` ${paint(term, "muted", "·")} none`;
  const names = result.ids.map(id => {
    const option = options.find(o => o.id === id);
    return option?.label ?? id;
  });
  return ` ${paint(term, "ok", "✓")} ${cut(names.join(", "), term.width - 3)}`;
};

/** The plain prompt: numbered options, then `Choose [n,n]: ` until one fits. */
const multiselectPlain = (
  io: PromptIO,
  o: MultiselectOptions,
): Promise<MultiselectResult> => {
  const term = termOf(io.output, io.env);
  const say = (text: string): void => {
    io.output.write(`${text}\n`);
  };
  for (const line of o.header?.(term) ?? []) say(line);
  for (const line of plainOptions(o.options, "")) say(line);
  for (const line of o.footer ?? []) say(line);
  const initial = new Set(o.initial);
  const start = inOrder(o.options, initial)
    .map(id => String(o.options.findIndex(opt => opt.id === id) + 1))
    .join(",");
  const hint = start === "" ? "" : ` [${start}]`;
  const ask = async (): Promise<MultiselectResult> => {
    const answer = await readLine(
      io,
      `  Choose, e.g. 1,3 (Enter for ${start === "" ? "none" : "the default"})${hint}: `,
      o.signal,
    );
    if (answer === undefined) {
      if (o.later === true) return { kind: "later" };
      throw new Error("input ended");
    }
    const value = answer.trim();
    if (value === "")
      return { kind: "chosen", ids: inOrder(o.options, initial) };
    // Parsed first, so an option named `q` or `none` wins over what they do.
    const ids = pickMany(value, o.options);
    if (ids !== undefined) return { kind: "chosen", ids };
    if (o.later === true && value === "q") return { kind: "later" };
    if (value === "none") return { kind: "chosen", ids: [] };
    say("  Type option numbers or ids, separated by commas.");
    return ask();
  };
  return ask();
};

/** Asks for any number of `options`, none included. */
export const multiselect = (
  io: PromptIO,
  o: MultiselectOptions,
): Promise<MultiselectResult> => {
  if (o.signal?.aborted === true) return Promise.reject(withdrawn(o.signal));
  if (!canKey(io.input, io.output, io.env)) return multiselectPlain(io, o);
  const term = () => termOf(io.output, io.env);
  const region = createRegion(io.output, term);
  return new Promise<MultiselectResult>((resolve, reject) => {
    const ticked = new Set(o.initial);
    let cursor = 0;

    /** Each option's lines; `compact`, only the chosen one has its description. */
    const optionBlocks = (t: Term, compact: boolean): string[][] =>
      o.options.map((option, i) => {
        const selected = i === cursor;
        const number = i < 9 ? `${String(i + 1)}.` : "  ";
        const box = ticked.has(option.id) ? "[x]" : "[ ]";
        const look: Look = selected
          ? text => apply(t, ["bold", "cyan"], text)
          : asIs;
        const prefix = cut(`${box} ${number} `, t.width - 4);
        const indent = " ".repeat(3 + widthOf(prefix));
        const names = nameLines(t, option, t.width - 4 - widthOf(prefix), look);
        const pointer = selected ? paint(t, "accent", "❯") : " ";
        // The name wraps, never cut: it is what the person picks.
        const lines = names.map((name, k) =>
          k === 0 ? ` ${pointer} ${look(prefix)}${name}` : `${indent}${name}`,
        );
        if (compact && !selected) return lines;
        for (const line of wrap(option.description ?? "", t.width - 11)) {
          if (line !== "") lines.push(paint(t, "muted", `          ${line}`));
        }
        return lines;
      });

    const render = (): void => {
      const t = term();
      const muted = (text: string): string => paint(t, "muted", text);
      const keys = ["↑/↓ move", "Space tick", "Enter confirm"];
      if (o.later === true) keys.push("q later");
      const { head, body } = fitSelect(t, {
        head: o.header?.(t) ?? [],
        blocks: compact => optionBlocks(t, compact),
        cursor,
        details: [],
        hasDetails: false,
        tail: 1,
        muted,
      });
      region.draw(
        barred(t, [
          ...head,
          ...body,
          muted(cut(` ${keys.join(" · ")}`, t.width)),
        ]),
      );
    };

    const cleanup = (): void => {
      io.output.off("resize", render);
      o.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (result: Settled): void => {
      stop();
      cleanup();
      region.finish(doneLine(o.options, result, term()));
      resolve(result);
    };
    const onAbort = (): void => {
      stop();
      cleanup();
      region.finish();
      reject(withdrawn(o.signal));
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
      } else if (key.name === "enter") {
        finish({ kind: "chosen", ids: inOrder(o.options, ticked) });
      } else if (key.name === "up") move(cursor - 1);
      else if (key.name === "down") move(cursor + 1);
      else if (key.name === "home") move(0);
      else if (key.name === "end") move(o.options.length - 1);
      else if (key.name === "escape" && o.later === true) {
        finish({ kind: "later" });
      } else if (key.name === "char") {
        const c = key.text;
        if (c === "k") move(cursor - 1);
        else if (c === "j") move(cursor + 1);
        else if (c === " ") {
          const id = o.options[cursor]?.id;
          if (id === undefined) return;
          if (!ticked.delete(id)) ticked.add(id);
          render();
        } else if (c >= "1" && c <= "9") {
          if (Number(c) <= o.options.length) move(Number(c) - 1);
        } else if (c === "q" && o.later === true) finish({ kind: "later" });
      }
    });
    io.output.on("resize", render);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    render();
  });
};
