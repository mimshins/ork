/**
 * @file Tests for the multiselect prompt on a fake terminal: the card it draws,
 *   each key (move, tick, confirm, none, later, interrupt), that it collapses
 *   to one line and restores the terminal, and the numbered plain prompt that
 *   takes `1,3`.
 */

import { describe, expect, it } from "vitest";

import {
  multiselect,
  type MultiselectOptions,
  type MultiselectResult,
} from "../src/term/multiselect.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const OPTIONS: MultiselectOptions["options"] = [
  { id: "a", label: "Alpha", description: "The first one" },
  { id: "b", description: "The second one" },
  { id: "c" },
];

const open = (
  term: FakeTerm,
  extra: Partial<MultiselectOptions> = {},
): Promise<MultiselectResult> =>
  multiselect(term.io, {
    options: OPTIONS,
    header: () => [" Which ones?"],
    ...extra,
  });

/** What pressing `keys` then Enter gives. */
const choose = async (keys: string[]): Promise<MultiselectResult> => {
  const term = fakeTerm();
  const result = open(term);
  await term.press(...keys, KEY.enter);
  return result;
};

describe("multiselect, on a terminal", () => {
  it("draws the card with boxes, and confirms the ticked ones in option order", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press();
    expect(term.screen()).toEqual([
      "▌Which ones?",
      "▌❯ [ ] 1. Alpha (a)",
      "▌         The first one",
      "▌  [ ] 2. b",
      "▌         The second one",
      "▌  [ ] 3. c",
      "▌↑/↓ move · Space tick · Enter confirm",
    ]);
    expect(term.rawMode()).toBe(true);
    await term.press(KEY.end, " ", KEY.home, " ");
    expect(term.screen()).toContain("▌❯ [x] 1. Alpha (a)");
    expect(term.screen()).toContain("▌  [x] 3. c");
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", ids: ["a", "c"] });
    expect(term.screen()).toEqual([" ✓ Alpha, c"]);
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
  });

  it("takes none as an answer", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", ids: [] });
    expect(term.screen()).toEqual([" · none"]);
  });

  it("starts with the initial ids ticked", async () => {
    const term = fakeTerm();
    const result = open(term, { initial: ["b"] });
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", ids: ["b"] });
  });

  it.each([
    ["Space twice unticks", [" ", " "], []],
    ["down then Space", [KEY.down, " "], ["b"]],
    ["j and k", ["j", "j", " ", "k", " "], ["b", "c"]],
    ["a number moves", ["3", " "], ["c"]],
    ["9 with three options does nothing", ["9", " "], ["a"]],
    ["past the end stays", [KEY.down, KEY.down, KEY.down, " "], ["c"]],
    ["up at the start stays", [KEY.up, " "], ["a"]],
  ])("%s", async (_name, keys, ids) => {
    expect(await choose(keys)).toEqual({ kind: "chosen", ids });
  });

  it.each([
    ["q", "q"],
    ["Esc", KEY.esc],
  ])("leaves the question for later with %s", async (_name, key) => {
    const term = fakeTerm();
    const result = open(term, { later: true });
    await term.press(" ", key);
    expect(await result).toEqual({ kind: "later" });
    expect(term.screen()).toEqual([" · left for later"]);
  });

  it("does not leave on q or Esc unless the prompt allows it", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press("q", KEY.esc, KEY.enter);
    expect(await result).toEqual({ kind: "chosen", ids: [] });
  });

  it("stops on Ctrl-C: the terminal restored first, then the interrupt", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press(KEY.ctrlC);
    expect(await result).toEqual({ kind: "interrupted" });
    expect(term.interrupted()).toBe(1);
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
    expect(term.screen()).toEqual([]);
  });

  it("keeps every line within the width and draws again on a resize", async () => {
    const term = fakeTerm({ columns: 30 });
    const result = open(term, { later: true });
    await term.press();
    expect(
      Math.max(...term.screen().map(line => Array.from(line).length)),
    ).toBeLessThanOrEqual(30);
    term.resize(24);
    expect(
      Math.max(...term.screen().map(line => Array.from(line).length)),
    ).toBeLessThanOrEqual(24);
    await term.press(KEY.enter);
    await result;
  });

  it("fits a short terminal without piling up copies", async () => {
    const term = fakeTerm({ rows: 8 });
    const result = open(term, {
      options: Array.from({ length: 12 }, (_, i) => ({ id: `o${String(i)}` })),
    });
    await term.press(KEY.down, KEY.down, KEY.down);
    expect(term.screen().length).toBeLessThanOrEqual(7);
    expect(
      term.screen().filter(line => line.includes("Which ones")),
    ).toHaveLength(1);
    await term.press(KEY.enter);
    await result;
  });

  it("rejects when withdrawn, leaving the terminal restored", async () => {
    const term = fakeTerm();
    const abort = new AbortController();
    const result = open(term, { signal: abort.signal });
    await term.press();
    abort.abort(new Error("the question was withdrawn"));
    await expect(result).rejects.toThrow("the question was withdrawn");
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
  });
});

describe("multiselect, plain", () => {
  it("asks for numbers and takes 1,3", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term);
    await term.press("1,3\n");
    expect(await result).toEqual({ kind: "chosen", ids: ["a", "c"] });
    expect(term.raw()).toBe(
      [
        " Which ones?",
        "  1) Alpha (a) - The first one",
        "  2) b - The second one",
        "  3) c",
        "  Choose, e.g. 1,3 (Enter for none): ",
      ].join("\n"),
    );
    expect(term.raw()).not.toContain("\u001B");
    expect(term.rawMode()).toBe(false);
  });

  it("takes spaces, ids and repeats, in option order", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term);
    await term.press("c 1 c b\n");
    expect(await result).toEqual({ kind: "chosen", ids: ["a", "b", "c"] });
  });

  it("takes Enter for none, or for the initial ids", async () => {
    const none = fakeTerm({ tty: false });
    const a = open(none);
    await none.press("\n");
    expect(await a).toEqual({ kind: "chosen", ids: [] });
    const start = fakeTerm({ tty: false });
    const b = open(start, { initial: ["b", "a"] });
    await start.press("\n");
    expect(await b).toEqual({ kind: "chosen", ids: ["a", "b"] });
    expect(start.raw()).toContain("(Enter for the default) [1,2]: ");
  });

  it("takes the word none as none", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, { initial: ["a"] });
    await term.press("none\n");
    expect(await result).toEqual({ kind: "chosen", ids: [] });
  });

  it("asks again on an answer that names nothing, or only partly", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term);
    await term.press("zzz\n", "1,9\n", "2\n");
    expect(await result).toEqual({ kind: "chosen", ids: ["b"] });
    expect(term.raw().split("Type option numbers or ids").length - 1).toBe(2);
  });

  it("takes q for later where it may wait, and as a wrong answer elsewhere", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, { later: true });
    await term.press("q\n");
    expect(await result).toEqual({ kind: "later" });
    const strict = fakeTerm({ tty: false });
    const asked = open(strict);
    await strict.press("q\n", "1\n");
    expect(await asked).toEqual({ kind: "chosen", ids: ["a"] });
  });

  it("rejects when the input ends, or leaves it for later where it may", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term);
    term.end();
    await expect(result).rejects.toThrow("input ended");
    const later = fakeTerm({ tty: false });
    const asked = open(later, { later: true });
    later.end();
    expect(await asked).toEqual({ kind: "later" });
  });

  it("is plain on NO_COLOR too", async () => {
    const term = fakeTerm({ env: { NO_COLOR: "1" } });
    const result = open(term);
    await term.press("2\n");
    expect(await result).toEqual({ kind: "chosen", ids: ["b"] });
  });
});
