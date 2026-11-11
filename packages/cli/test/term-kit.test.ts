/**
 * @file Tests for the terminal kit's basics: the mode (a terminal, `NO_COLOR`,
 *   `ORK_PLAIN`), the global `--plain` flag, the theme and chips (colors on or
 *   off, a stable color per node), the layout (wrap, cut, hang), and the key
 *   parser.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { completionLines, main } from "../src/index.ts";
import { chip, CHIP_LABELS, nodeChip, nodeSlot } from "../src/term/chips.ts";
import { parseKeys } from "../src/term/keys.ts";
import { cut, hang, rowsOf, widthOf, wrap } from "../src/term/layout.ts";
import {
  plainEnv,
  takePlainFlag,
  type Term,
  termOf,
} from "../src/term/mode.ts";
import { NODE_PALETTE, paint, type Role } from "../src/term/theme.ts";
import { tempDir } from "./fixtures/completion.ts";
import { fakeTerm } from "./term-fake.ts";

/** The flag candidates for `words`, outside any project. */
const offered = async (...words: string[]): Promise<string[]> =>
  (
    await completionLines(main, words, tempDir("ork-complete-cwd-"), "/none")
  ).map(line => line.split("\t")[0] ?? "");

const ROLES: Role[] = ["accent", "ok", "warn", "danger", "muted"];
const RICH: Term = { rich: true, width: 40, rows: 24 };
const PLAIN: Term = { rich: false, width: 40, rows: 24 };

describe("mode", () => {
  it("is rich on a terminal with no variable asking for plain", () => {
    const { io } = fakeTerm({ columns: 100, rows: 30 });
    expect(termOf(io.output, {})).toEqual({ rich: true, width: 100, rows: 30 });
  });

  it("is plain when the stream is not a terminal, and 80 wide with no width", () => {
    const { io } = fakeTerm({ tty: false });
    expect(termOf(io.output, {}).rich).toBe(false);
    const unsized = Object.assign(new PassThrough(), { isTTY: true });
    expect(termOf(unsized, {}).width).toBe(80);
  });

  it.each([
    [{ NO_COLOR: "1" }, true],
    [{ ORK_PLAIN: "1" }, true],
    [{ ORK_PLAIN: "true" }, true],
    [{ TERM: "dumb" }, true],
    [{ ORK_PLAIN: "0" }, false],
    [{ NO_COLOR: "" }, false],
    [{}, false],
  ])("reads %j as plain: %s", (env, plain) => {
    expect(plainEnv(env)).toBe(plain);
  });

  it("is plain on a terminal when NO_COLOR or ORK_PLAIN is set", () => {
    const { io } = fakeTerm();
    expect(termOf(io.output, { NO_COLOR: "1" }).rich).toBe(false);
    expect(termOf(io.output, { ORK_PLAIN: "1" }).rich).toBe(false);
  });

  it("never lays out narrower than 20 columns", () => {
    const { io } = fakeTerm({ columns: 5 });
    expect(termOf(io.output, {}).width).toBe(20);
  });
});

describe("--plain", () => {
  it("is taken out of the arguments and sets ORK_PLAIN", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(takePlainFlag(["--plain", "run", "wf"], env)).toEqual(["run", "wf"]);
    expect(env["ORK_PLAIN"]).toBe("1");
  });

  it("is found after the command too, but not after `--`", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(
      takePlainFlag(["run", "wf", "--plain", "--", "--plain"], env),
    ).toEqual(["run", "wf", "--", "--plain"]);
  });

  it("leaves the environment alone when it is not given", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(takePlainFlag(["ps"], env)).toEqual(["ps"]);
    expect(env["ORK_PLAIN"]).toBeUndefined();
  });

  it("is offered by tab completion on every command", async () => {
    expect(await offered("ps", "--p")).toContain("--plain");
    expect(await offered("--p")).toContain("--plain");
  });
});

describe("theme and chips", () => {
  it("styles in rich mode and leaves text as is in plain mode", () => {
    expect(paint(RICH, "danger", "x")).toContain("\u001B[");
    expect(paint(PLAIN, "danger", "x")).toBe("x");
  });

  it("puts words on a chip: a background when rich, brackets when plain", () => {
    expect(chip(RICH, CHIP_LABELS.ask, "accent")).toContain(" ASK ");
    expect(chip(RICH, CHIP_LABELS.ask, "accent")).toContain("\u001B[");
    expect(chip(PLAIN, CHIP_LABELS.ask, "accent")).toBe("[ASK]");
    expect(chip(PLAIN, CHIP_LABELS.fail, "danger")).toBe("[FAIL]");
  });

  it("gives a node the same chip on every call, and has a slot for each id", () => {
    expect(nodeChip(RICH, "add-invalid-node")).toBe(
      nodeChip(RICH, "add-invalid-node"),
    );
    expect(nodeChip(PLAIN, "build")).toBe("[build]");
    const ids = Array.from({ length: 60 }, (_, i) => `node-${String(i)}`);
    const slots = new Set(ids.map(id => nodeSlot(id)));
    expect(slots.size).toBe(NODE_PALETTE.length);
    expect([...slots].every(slot => slot < NODE_PALETTE.length)).toBe(true);
  });

  it("uses only the 16 ANSI colors: no 256-color or true-color codes", () => {
    const all = [
      ...ROLES.map(role => chip(RICH, "X", role)),
      ...Array.from({ length: 30 }, (_, i) => nodeChip(RICH, `n${String(i)}`)),
    ].join("");
    expect(all).not.toContain("\u001B[38;");
    expect(all).not.toContain("\u001B[48;");
  });
});

describe("layout", () => {
  it("wraps at spaces, keeps line breaks and splits a word too long", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"]);
    expect(wrap("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });

  it("cuts to one line with an ellipsis", () => {
    expect(cut("abcdef", 4)).toBe("abc…");
    expect(cut("abc", 3)).toBe("abc");
  });

  it("hangs wrapped lines under the lead", () => {
    expect(hang("tool: ", "aaa bbb ccc", 12)).toEqual([
      "tool: aaa",
      "      bbb",
      "      ccc",
    ]);
  });

  it("measures without escape codes", () => {
    expect(widthOf(paint(RICH, "ok", "abc"))).toBe(3);
    expect(rowsOf("a".repeat(45), 20)).toBe(3);
    expect(rowsOf("", 20)).toBe(1);
  });
});

describe("keys", () => {
  it.each([
    ["\u001B[A", "up"],
    ["\u001B[B", "down"],
    ["\u001BOA", "up"],
    ["\u001B[H", "home"],
    ["\u001B[4~", "end"],
    ["\u001B[3~", "delete"],
    ["\u001B", "escape"],
    ["\r", "enter"],
    ["\u007F", "backspace"],
    ["\u0003", "ctrl-c"],
  ])("reads %j as %s", (bytes, name) => {
    expect(parseKeys(bytes)).toEqual([{ name }]);
  });

  it("reads a pasted run of characters, then Enter", () => {
    expect(parseKeys("hé\r")).toEqual([
      { name: "char", text: "h" },
      { name: "char", text: "é" },
      { name: "enter" },
    ]);
  });

  it("skips a sequence it does not know, and the rest still reads", () => {
    expect(parseKeys("\u001B[5;3~x")).toEqual([{ name: "char", text: "x" }]);
  });
});
