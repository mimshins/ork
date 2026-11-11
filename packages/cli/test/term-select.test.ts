/**
 * @file Tests for the select prompt on a fake terminal: the card it draws, each
 *   key (move, jump, choose, note, details, later, interrupt), that it redraws
 *   only its own lines and collapses to one line, follows a resize, restores
 *   the terminal, and falls back to numbered options when plain.
 */

import { describe, expect, it } from "vitest";

import { printAbove } from "../src/term/screen.ts";
import {
  select,
  type SelectOptions,
  type SelectResult,
} from "../src/term/select.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const OPTIONS: SelectOptions["options"] = [
  { id: "a", label: "Alpha", description: "The first one" },
  { id: "b", description: "The second one" },
  { id: "c" },
];

/** Opens a select on `term` with the three options, `b` recommended. */
const open = (
  term: FakeTerm,
  extra: Partial<SelectOptions> = {},
): Promise<SelectResult> =>
  select(term.io, {
    options: OPTIONS,
    recommended: "b",
    header: () => [" Ship it?"],
    ...extra,
  });

/** What choosing with `keys` from the start gives. */
const choose = async (keys: string[]): Promise<SelectResult> => {
  const term = fakeTerm();
  const result = open(term);
  await term.press(...keys, KEY.enter);
  return result;
};

describe("select, on a terminal", () => {
  it("draws the card: header, options, the recommended one marked and chosen, key line", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press();
    expect(term.screen()).toEqual([
      " Ship it?",
      "   1. a Alpha",
      "      The first one",
      " ❯ 2. b (recommended)",
      "      The second one",
      "   3. c",
      " ↑/↓ move · Enter choose",
    ]);
    expect(term.rawMode()).toBe(true);
    expect(term.hidden()).toBe(true);
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b" });
  });

  it("collapses to one line after the answer and restores the terminal", async () => {
    const term = fakeTerm();
    term.io.output.write("before\n");
    const result = open(term);
    await term.press(KEY.down, KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "c" });
    expect(term.screen()).toEqual(["before", " ✓ c"]);
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
  });

  it.each([
    ["down", [KEY.down], "c"],
    ["up", [KEY.up], "a"],
    ["j", ["j"], "c"],
    ["k", ["k", "k"], "a"],
    ["down past the end stays", [KEY.down, KEY.down, KEY.down], "c"],
    ["Home", [KEY.home], "a"],
    ["End", [KEY.end], "c"],
    ["1", ["1"], "a"],
    ["3", ["3"], "c"],
    ["9 with three options does nothing", ["9"], "b"],
  ])("moves with %s", async (_name, keys, id) => {
    expect(await choose(keys)).toEqual({ kind: "chosen", id });
  });

  it("starts on the first option when none is recommended", async () => {
    const term = fakeTerm();
    const result = select(term.io, { options: OPTIONS });
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "a" });
  });

  it("redraws only its own lines as the cursor moves", async () => {
    const term = fakeTerm();
    term.io.output.write("before\n");
    const result = open(term);
    await term.press(KEY.up);
    expect(term.screen()[0]).toBe("before");
    expect(term.screen().filter(line => line.startsWith(" ❯"))).toEqual([
      " ❯ 1. a Alpha",
    ]);
    expect(term.raw()).not.toContain("\u001B[2J");
    await term.press(KEY.enter);
    await result;
  });

  it("takes a note with n, shows it, and returns it with the choice", async () => {
    const term = fakeTerm();
    const result = open(term, { note: true });
    await term.press("n");
    expect(term.screen().at(-1)).toBe(" ✎ Note ›");
    await term.press("h", "i", KEY.enter);
    expect(term.screen()).toContain(" note: hi");
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b", note: "hi" });
  });

  it("drops a note started with Esc, and does not leave the question", async () => {
    const term = fakeTerm();
    const result = open(term, { note: true, later: true });
    await term.press("n", "x", KEY.esc);
    expect(term.screen().join("\n")).not.toContain("note:");
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b" });
  });

  it("types n, j and q into a note rather than acting on them", async () => {
    const term = fakeTerm();
    const result = open(term, { note: true, later: true });
    await term.press("n", "q", "j", "n", KEY.enter, KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b", note: "qjn" });
  });

  it("ignores n when the prompt takes no note", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press("n");
    expect(term.screen().at(-1)).toBe(" ↑/↓ move · Enter choose");
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b" });
  });

  it("shows and hides the details with d", async () => {
    const term = fakeTerm({ columns: 60 });
    const result = open(term, { details: "line one\nline two" });
    expect(term.screen().at(-1)).toContain("d show details");
    await term.press("d");
    expect(term.screen()).toContain("   line two");
    expect(term.screen().at(-1)).toContain("d hide details");
    await term.press("d");
    expect(term.screen().join("\n")).not.toContain("line two");
    await term.press(KEY.enter);
    await result;
  });

  it("cuts long details to the screen, saying how many lines are left", async () => {
    const term = fakeTerm({ rows: 14 });
    const details = Array.from(
      { length: 30 },
      (_, i) => `row ${String(i)}`,
    ).join("\n");
    const result = open(term, { details });
    await term.press("d");
    expect(term.screen().length).toBeLessThanOrEqual(14);
    expect(term.screen().join("\n")).toMatch(/… \d+ more lines/u);
    await term.press(KEY.enter);
    await result;
  });

  it.each([
    ["q", "q"],
    ["Esc", KEY.esc],
  ])("leaves the question for later with %s", async (_name, key) => {
    const term = fakeTerm();
    const result = open(term, { later: true });
    await term.press(key);
    expect(await result).toEqual({ kind: "later" });
    expect(term.screen()).toEqual([" · left for later"]);
  });

  it("does not leave on q or Esc unless the prompt allows it", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press("q", KEY.esc, KEY.enter);
    expect(await result).toEqual({ kind: "chosen", id: "b" });
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

  it("draws again on a resize, to the new width", async () => {
    const term = fakeTerm({ columns: 40 });
    const result = open(term, {
      options: [{ id: "a-long-option-id", label: "with a long label here" }],
    });
    await term.press();
    expect(term.screen()[1]).toBe(" ❯ 1. a-long-option-id with a long lab…");
    term.resize(24);
    expect(term.screen()[1]).toBe(" ❯ 1. a-long-option-id…");
    await term.press(KEY.enter);
    await result;
  });

  it("keeps every line within the width", async () => {
    const term = fakeTerm({ columns: 30 });
    const result = open(term, { note: true, later: true, details: "d" });
    await term.press();
    expect(
      Math.max(...term.screen().map(line => Array.from(line).length)),
    ).toBeLessThanOrEqual(30);
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

describe("select, with lines printed meanwhile", () => {
  it("keeps a line printed above the card once, and the card once", async () => {
    const term = fakeTerm();
    term.io.output.write("before\n");
    const result = open(term);
    await term.press();
    expect(printAbove("transcript line")).toBe(true);
    await term.press(KEY.down);
    expect(term.screen()).toEqual([
      "before",
      "transcript line",
      " Ship it?",
      "   1. a Alpha",
      "      The first one",
      "   2. b (recommended)",
      "      The second one",
      " ❯ 3. c",
      " ↑/↓ move · Enter choose",
    ]);
    await term.press(KEY.enter);
    await result;
    expect(term.screen()).toEqual(["before", "transcript line", " ✓ c"]);
  });

  it("keeps several lines in order, and a long one", async () => {
    const term = fakeTerm({ columns: 20 });
    const result = open(term);
    await term.press();
    printAbove("one");
    printAbove("two");
    await term.press(KEY.up);
    expect(term.screen().slice(0, 2)).toEqual(["one", "two"]);
    expect(term.screen().filter(line => line.startsWith(" Ship"))).toHaveLength(
      1,
    );
    await term.press(KEY.enter);
    await result;
  });

  it("is not taken once the prompt is done", async () => {
    const term = fakeTerm();
    const result = open(term);
    await term.press(KEY.enter);
    await result;
    expect(printAbove("late")).toBe(false);
  });
});

describe("select, plain", () => {
  it("falls back to numbered options on a terminal that has no raw mode", async () => {
    const term = fakeTerm({ rawMode: false });
    const result = open(term);
    await term.press("2\n");
    expect(await result).toEqual({ kind: "chosen", id: "b" });
    expect(term.raw()).toContain("  2) b - The second one (recommended)");
    expect(term.raw()).not.toContain("\u001B[?25l");
  });

  it("prints the footer just above the question", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, {
      footer: ["  Document: 50 lines. Type d to read it."],
    });
    await term.press("\n");
    await result;
    expect(term.raw()).toContain(
      "  3) c\n  Document: 50 lines. Type d to read it.\n  Choose [2]: ",
    );
  });

  /** A plain pair of pipes, or a terminal asked for plain. */
  const plains: [string, () => FakeTerm][] = [
    ["not a terminal", () => fakeTerm({ tty: false })],
    ["NO_COLOR", () => fakeTerm({ env: { NO_COLOR: "1" } })],
    ["ORK_PLAIN", () => fakeTerm({ env: { ORK_PLAIN: "1" } })],
  ];

  it.each(plains)("asks the numbered question when %s", async (_name, make) => {
    const term = make();
    const result = open(term);
    await term.press("3\n");
    expect(await result).toEqual({ kind: "chosen", id: "c" });
    expect(term.raw()).toBe(
      [
        " Ship it?",
        "  1) a Alpha - The first one",
        "  2) b - The second one (recommended)",
        "  3) c",
        "  Choose [2]: ",
      ].join("\n"),
    );
    expect(term.raw()).not.toContain("\u001B");
    expect(term.rawMode()).toBe(false);
  });

  it("takes Enter for the recommended option, an id for itself", async () => {
    const first = fakeTerm({ tty: false });
    const a = open(first);
    await first.press("\n");
    expect(await a).toEqual({ kind: "chosen", id: "b" });
    const second = fakeTerm({ tty: false });
    const b = open(second);
    await second.press("a\n");
    expect(await b).toEqual({ kind: "chosen", id: "a" });
  });

  it("asks again on an answer that names nothing, and shows the details on d", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, { details: "the whole document" });
    await term.press("zzz\n", "d\n", "1\n");
    expect(await result).toEqual({ kind: "chosen", id: "a" });
    expect(term.raw()).toContain("  Type an option's number or id.");
    expect(term.raw()).toContain("the whole document");
  });

  it("asks for a note after the choice, as today", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, { note: true });
    await term.press("1\n", "because\n");
    expect(await result).toEqual({ kind: "chosen", id: "a", note: "because" });
    expect(term.raw()).toContain(
      "  Note for the run (optional, Enter to skip): ",
    );
  });

  it("does not return an empty note", async () => {
    const term = fakeTerm({ tty: false });
    const result = open(term, { note: true });
    await term.press("1\n", "\n");
    expect(await result).toEqual({ kind: "chosen", id: "a" });
  });

  it("rejects when the input ends with nothing chosen", async () => {
    const term = fakeTerm({ tty: false });
    const result = select(term.io, { options: OPTIONS });
    term.end();
    await expect(result).rejects.toThrow("input ended");
  });
});
