/**
 * @file Tests for lessons (ADR-059): a lesson is a line in its workflow's file,
 *   marked with its item so it isn't added twice; one that would pass the cap
 *   is refused; and a file made longer by hand loads cut at the cap, on a
 *   line's end, saying how long it was.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addLesson,
  capLessons,
  estimateTokens,
  inRepoPlace,
  LESSON_CAP_TOKENS,
  lessons,
  lessonsFileOf,
} from "../src/index.ts";

const ITEM = "0123456789abcdef0123";

/** A project's lessons file for `notes`, not written yet. */
const fresh = () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-lessons-")));
  const file = lessonsFileOf(inRepoPlace(root), "notes");
  return { root, file, shownAs: ".ork/lessons/notes.md", workflow: "notes" };
};

/** A line of about `tokens` tokens. */
const lineOf = (tokens: number): string => `- ${"x".repeat(tokens * 4 - 3)}\n`;

describe("adding a lesson", () => {
  it("starts the file, and marks the line with its item", () => {
    const where = fresh();
    const added = addLesson({
      ...where,
      item: ITEM,
      text: "Say where the spec is.",
    });
    expect(added.ok).toBe(true);
    expect(readFileSync(where.file, "utf8")).toBe(
      "# Lessons for notes\n\n- Say where the spec is. <!-- feedback 0123456789ab -->\n",
    );
  });

  it("keeps a lesson's later lines under its first", () => {
    const where = fresh();
    addLesson({ ...where, item: ITEM, text: "First.\nThen this.\n" });
    expect(readFileSync(where.file, "utf8")).toContain(
      "- First. <!-- feedback 0123456789ab -->\n  Then this.\n",
    );
  });

  it("refuses the same item twice, and an empty lesson", () => {
    const where = fresh();
    addLesson({ ...where, item: ITEM, text: "Once." });
    expect(addLesson({ ...where, item: ITEM, text: "Twice." })).toEqual({
      ok: false,
      error: "0123456789ab is already a lesson in .ork/lessons/notes.md.",
    });
    expect(addLesson({ ...where, item: "ff", text: "  " })).toEqual({
      ok: false,
      error: "The lesson is empty.",
    });
  });

  it("refuses one that would take the file past the cap, and writes nothing", () => {
    const where = fresh();
    mkdirSync(path.dirname(where.file), { recursive: true });
    const full = lineOf(LESSON_CAP_TOKENS - 10);
    writeFileSync(where.file, full);
    const added = addLesson({ ...where, item: ITEM, text: "x".repeat(200) });
    expect(added).toEqual({
      ok: false,
      error: `.ork/lessons/notes.md would be about ${estimateTokens(`${full}- ${"x".repeat(200)} <!-- feedback 0123456789ab -->\n`).toLocaleString("en")} tokens, over the 1,500 a session loads. Edit it to make room, then accept again.`,
    });
    expect(readFileSync(where.file, "utf8")).toBe(full);
  });
});

describe("loading lessons", () => {
  it("loads a file under the cap whole", () => {
    expect(capLessons("- a\n")).toEqual({ text: "- a\n" });
  });

  it("cuts a longer file at the cap, on a line's end", () => {
    const text = lineOf(1000) + lineOf(1000);
    const capped = capLessons(text);
    expect(capped.text).toBe(lineOf(1000));
    expect(capped.cutFrom).toBe(estimateTokens(text));
  });

  it("says what was cut where the workflow layer reads it", () => {
    const where = fresh();
    mkdirSync(path.dirname(where.file), { recursive: true });
    writeFileSync(where.file, lineOf(1000) + lineOf(1000));
    const [file] = lessons("notes", where.root);
    expect(file?.name).toBe(".ork/lessons/notes.md");
    expect(file?.text).toBe(lineOf(1000));
    expect(file?.cutFrom).toBe(2000);
  });
});
