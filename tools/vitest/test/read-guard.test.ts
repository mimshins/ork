/**
 * @file Tests for the read guard's check: the tests' `--on` pathspecs read from
 *   `check:all`, and which reads they leave out (a file, or a folder whose
 *   files are all left out).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkAllOf, leftOut, testsPathspecs } from "../read-guard-check.ts";

describe("the tests' pathspecs", () => {
  it("reads the --on list of the tests step, quoted or not", () => {
    expect(
      testsPathspecs(
        "pnpm lint && pnpm ork once --as tests --on . --on ':(exclude)specs' --on=x -- pnpm run test && pnpm docs:check",
      ),
    ).toEqual([".", ":(exclude)specs"]);
  });

  it("finds this repository's list", () => {
    const checkAll = checkAllOf(
      readFileSync(
        path.resolve(import.meta.dirname, "../../../package.json"),
        "utf8",
      ),
    );
    expect(testsPathspecs(String(checkAll))).toEqual(
      expect.arrayContaining([".", ":(exclude)specs", ":(exclude)README.md"]),
    );
  });
});

describe("what the pathspecs leave out", () => {
  const all = new Set([
    "README.md",
    "package.json",
    "docs/guides/a.md",
    "docs/guides/i.md",
    "specs/x.md",
  ]);
  const kept = new Set(["package.json", "docs/guides/i.md"]);

  it("names a read file left out, and not one kept", () => {
    expect(leftOut(["README.md", "package.json"], all, kept)).toEqual([
      "README.md",
    ]);
  });

  it("names a folder only when all of its files are left out", () => {
    expect(leftOut(["specs", "docs/guides", "docs"], all, kept)).toEqual([
      "specs",
    ]);
  });

  it("ignores a path that isn't in the repository", () => {
    expect(leftOut(["nowhere.md"], all, kept)).toEqual([]);
  });
});
