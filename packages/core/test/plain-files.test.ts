/**
 * @file Tests that Ork never writes its own files through a link a cloned
 *   repository could commit: a lessons file or folder that is a symlink, or a
 *   run folder aimed elsewhere, leaves the target untouched and says why; a
 *   linked lessons file isn't loaded; and a built-in's name is never one of an
 *   object's own keys.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addLesson,
  builtinProblem,
  builtinWorkflowFile,
  inRepoPlace,
  lessons,
  lessonsFileOf,
  unknownBuiltin,
  writePlainFile,
} from "../src/index.ts";

/** A project, and a file of the person's outside it. */
const setup = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-plain-")));
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  const victim = path.join(base, "profile");
  writeFileSync(victim, "export PATH=/usr/bin\n");
  return { base, root, victim, place: inRepoPlace(root) };
};

const lessonAsk = (root: string, file: string) => ({
  file,
  base: root,
  shownAs: ".ork/lessons/build.md",
  workflow: "build",
  item: "abcdef123456",
  text: "Run $(touch /tmp/pwned) before tests",
});

describe("writing through a link", () => {
  it("refuses a lessons file that is a link, and leaves its target", () => {
    const { root, victim, place } = setup();
    const file = lessonsFileOf(place, "build");
    mkdirSync(path.dirname(file), { recursive: true });
    symlinkSync(victim, file);
    expect(addLesson(lessonAsk(root, file))).toMatchObject({ ok: false });
    expect(readFileSync(victim, "utf8")).toBe("export PATH=/usr/bin\n");
  });

  it("refuses a lessons folder that is a link", () => {
    const { base, root, place } = setup();
    const elsewhere = path.join(base, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(path.join(root, ".ork"));
    symlinkSync(elsewhere, path.join(root, ".ork", "lessons"));
    const file = lessonsFileOf(place, "build");
    expect(addLesson(lessonAsk(root, file))).toMatchObject({ ok: false });
    expect(existsSync(path.join(elsewhere, "build.md"))).toBe(false);
  });

  it("doesn't load a lessons file that is a link", () => {
    const { root, victim, place } = setup();
    const file = lessonsFileOf(place, "build");
    mkdirSync(path.dirname(file), { recursive: true });
    symlinkSync(victim, file);
    expect(lessons("build", root)).toEqual([]);
  });

  it("refuses a built-in whose run folder is a link, and writes nothing", () => {
    const { base, root, place } = setup();
    const elsewhere = path.join(base, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(path.join(root, ".ork"));
    symlinkSync(elsewhere, path.join(root, ".ork", "runs"));
    expect(builtinProblem(place, "ork:feedback-apply")).toMatch(
      /^`\.ork\/runs\/\.builtin\/[0-9a-f]{12}\/feedback-apply\.ork\.yaml` is a link, or behind one/u,
    );
    expect(builtinWorkflowFile(place, "ork:feedback-apply")).toBeUndefined();
  });

  it("replaces a plain file by a rename, and refuses outside the base", () => {
    const { base, root } = setup();
    const file = path.join(root, ".ork", "x.md");
    expect(writePlainFile(root, file, "one\n")).toEqual({ ok: true });
    expect(writePlainFile(root, file, "two\n")).toEqual({ ok: true });
    expect(readFileSync(file, "utf8")).toBe("two\n");
    expect(writePlainFile(root, path.join(base, "out.md"), "x")).toMatchObject({
      ok: false,
    });
  });
});

describe("a built-in's name", () => {
  it("is never one of an object's own keys", () => {
    for (const name of ["ork:constructor", "ork:__proto__", "ork:toString"]) {
      expect(unknownBuiltin(name)).toMatch(/isn't one of Ork's workflows/u);
    }
  });
});
