/**
 * @file Tests for the text and confirm prompts on a fake terminal: editing
 *   keys, answers, collapse to one line, Esc and Ctrl-C, a resize, and the line
 *   prompts (`question [y/N] `) when plain, which keep today's answers.
 */

import { describe, expect, it } from "vitest";

import { confirm } from "../src/term/confirm.ts";
import { editLine, readText } from "../src/term/text.ts";
import { fakeTerm, KEY } from "./term-fake.ts";

describe("editLine", () => {
  it.each([
    [
      "types at the cursor",
      { value: "ac", pos: 1 },
      { name: "char", text: "b" },
      { value: "abc", pos: 2 },
    ],
    [
      "backspaces",
      { value: "abc", pos: 2 },
      { name: "backspace" },
      { value: "ac", pos: 1 },
    ],
    [
      "backspace at the start does nothing",
      { value: "abc", pos: 0 },
      { name: "backspace" },
      { value: "abc", pos: 0 },
    ],
    [
      "deletes",
      { value: "abc", pos: 1 },
      { name: "delete" },
      { value: "ac", pos: 1 },
    ],
    [
      "moves left",
      { value: "abc", pos: 0 },
      { name: "left" },
      { value: "abc", pos: 0 },
    ],
    [
      "moves right",
      { value: "abc", pos: 3 },
      { name: "right" },
      { value: "abc", pos: 3 },
    ],
    [
      "goes home",
      { value: "abc", pos: 2 },
      { name: "home" },
      { value: "abc", pos: 0 },
    ],
    [
      "goes to the end",
      { value: "abc", pos: 1 },
      { name: "ctrl-e" },
      { value: "abc", pos: 3 },
    ],
    [
      "clears before the cursor",
      { value: "abc", pos: 2 },
      { name: "ctrl-u" },
      { value: "c", pos: 0 },
    ],
    [
      "ignores up",
      { value: "abc", pos: 2 },
      { name: "up" },
      { value: "abc", pos: 2 },
    ],
  ] as const)("%s", (_name, state, key, after) => {
    expect(editLine({ ...state }, key)).toEqual(after);
  });
});

describe("readText, on a terminal", () => {
  it("edits in place and collapses to one line when sent", async () => {
    const term = fakeTerm();
    term.io.output.write("before\n");
    const result = readText(term.io, { message: "Note" });
    await term.press("h", "x", KEY.backspace, "i");
    expect(term.screen()).toEqual(["before", " ? Note › hi"]);
    expect(term.hidden()).toBe(false);
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "text", value: "hi" });
    expect(term.screen()).toEqual(["before", " ✓ Note · hi"]);
    expect(term.rawMode()).toBe(false);
  });

  it("starts from the text given, to edit it", async () => {
    const term = fakeTerm();
    const result = readText(term.io, { message: "Note", initial: "abc" });
    await term.press(KEY.left, KEY.backspace, KEY.enter);
    expect(await result).toEqual({ kind: "text", value: "ac" });
  });

  it("puts the cursor where the text is edited", async () => {
    const term = fakeTerm();
    const result = readText(term.io, { message: "Note", initial: "abc" });
    await term.press(KEY.left);
    expect(term.raw().endsWith("\u001B[?25h\r\u001B[12C")).toBe(true);
    await term.press(KEY.enter);
    await result;
  });

  it("scrolls a value too long for the line, keeping the cursor in view", async () => {
    const term = fakeTerm({ columns: 20 });
    const result = readText(term.io, { message: "N", initial: "x".repeat(40) });
    await term.press();
    expect(
      Math.max(...term.screen().map(line => Array.from(line).length)),
    ).toBeLessThan(20);
    await term.press(KEY.enter);
    await result;
  });

  it("answers an empty line as an empty text, collapsed as skipped", async () => {
    const term = fakeTerm();
    const result = readText(term.io, { message: "Note" });
    await term.press(KEY.enter);
    expect(await result).toEqual({ kind: "text", value: "" });
    expect(term.screen()).toEqual([" ✓ Note · skipped"]);
  });

  it("is cancelled by Esc", async () => {
    const term = fakeTerm();
    const result = readText(term.io, { message: "Note" });
    await term.press("a", KEY.esc);
    expect(await result).toEqual({ kind: "cancelled" });
  });

  it("stops on Ctrl-C with the terminal restored", async () => {
    const term = fakeTerm();
    const result = readText(term.io, { message: "Note" });
    await term.press(KEY.ctrlC);
    expect(await result).toEqual({ kind: "interrupted" });
    expect(term.interrupted()).toBe(1);
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
  });

  it("rejects when withdrawn", async () => {
    const term = fakeTerm();
    const abort = new AbortController();
    const result = readText(term.io, { message: "Note", signal: abort.signal });
    await term.press();
    abort.abort(new Error("the prompt was withdrawn"));
    await expect(result).rejects.toThrow("the prompt was withdrawn");
    expect(term.rawMode()).toBe(false);
  });
});

describe("readText, plain", () => {
  it("asks `message: ` and returns the trimmed line", async () => {
    const term = fakeTerm({ tty: false });
    const result = readText(term.io, {
      message: "Note for the run (optional, Enter to skip)",
    });
    await term.press("  because \n");
    expect(await result).toEqual({ kind: "text", value: "because" });
    expect(term.raw()).toBe("  Note for the run (optional, Enter to skip): ");
  });

  it("is cancelled when the input ends", async () => {
    const term = fakeTerm({ tty: false });
    const result = readText(term.io, { message: "Note" });
    term.end();
    expect(await result).toEqual({ kind: "cancelled" });
  });
});

describe("confirm, on a terminal", () => {
  it("shows the question with No chosen and collapses to one line", async () => {
    const term = fakeTerm();
    const result = confirm(term.io, { question: "Allow Bash?" });
    await term.press();
    expect(term.screen()).toEqual([
      " ? Allow Bash?",
      "    Yes   No   y/n · ←/→ · Enter",
    ]);
    await term.press(KEY.enter);
    expect(await result).toBe(false);
    expect(term.screen()).toEqual([" ✗ Allow Bash? · No"]);
    expect(term.hidden()).toBe(false);
    expect(term.rawMode()).toBe(false);
  });

  it.each([
    ["y", ["y"], true],
    ["Y", ["Y"], true],
    ["n", ["n"], false],
    ["Esc", [KEY.esc], false],
    ["→ then Enter", [KEY.left, KEY.enter], true],
    ["l then Enter", ["l", KEY.enter], true],
    ["a toggle twice", [KEY.left, KEY.right, KEY.enter], false],
    ["an unknown key does nothing", ["x", KEY.enter], false],
  ])("answers on %s", async (_name, keys, answer) => {
    const term = fakeTerm();
    const result = confirm(term.io, { question: "Go?" });
    await term.press(...keys);
    expect(await result).toBe(answer);
  });

  it("starts on Yes when that is the default", async () => {
    const term = fakeTerm();
    const result = confirm(term.io, { question: "Go?", default: true });
    await term.press(KEY.enter);
    expect(await result).toBe(true);
    expect(term.screen()).toEqual([" ✓ Go? · Yes"]);
  });

  it("wraps a long question under its mark", async () => {
    const term = fakeTerm({ columns: 24 });
    const result = confirm(term.io, {
      question: "Remove every worktree Ork made?",
    });
    await term.press();
    expect(term.screen().slice(0, 2)).toEqual([
      " ? Remove every worktree",
      "   Ork made?",
    ]);
    await term.press("n");
    await result;
  });

  it("is no on Ctrl-C, with the terminal restored and the interrupt sent", async () => {
    const term = fakeTerm();
    const result = confirm(term.io, { question: "Go?" });
    await term.press(KEY.ctrlC);
    expect(await result).toBe(false);
    expect(term.interrupted()).toBe(1);
    expect(term.rawMode()).toBe(false);
    expect(term.hidden()).toBe(false);
  });
});

describe("confirm, plain", () => {
  it.each([
    ["y\n", true],
    ["Yes\n", true],
    ["  YES \n", true],
    ["n\n", false],
    ["\n", false],
    ["maybe\n", false],
  ])("answers %j as %s, after `question [y/N] `", async (line, answer) => {
    const term = fakeTerm({ tty: false });
    const result = confirm(term.io, { question: "Allow?" });
    await term.press(line);
    expect(await result).toBe(answer);
    expect(term.raw()).toBe("  Allow? [y/N] ");
  });

  it("takes an empty line as the default when it is yes", async () => {
    const term = fakeTerm({ tty: false });
    const result = confirm(term.io, { question: "Go?", default: true });
    await term.press("\n");
    expect(await result).toBe(true);
    expect(term.raw()).toBe("  Go? [Y/n] ");
  });

  it("is no when the input ends", async () => {
    const term = fakeTerm({ tty: false });
    const result = confirm(term.io, { question: "Go?" });
    term.end();
    expect(await result).toBe(false);
  });

  it("is plain on a terminal with NO_COLOR: no escape codes", async () => {
    const term = fakeTerm({ env: { NO_COLOR: "1" } });
    const result = confirm(term.io, { question: "Go?" });
    await term.press("y\n");
    expect(await result).toBe(true);
    expect(term.raw()).toBe("  Go? [y/N] ");
  });
});
