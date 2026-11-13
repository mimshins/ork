/**
 * @file Tests for the Worktrees panel's CLI twins: each runs from the project's
 *   root, and a root or a key with a space or a quote is quoted, so a person
 *   who pastes it runs exactly what the panel would have done.
 */

import { describe, expect, it } from "vitest";

import {
  cleanTwin,
  countSaid,
  countWords,
  removeTwin,
} from "../../src/panels/worktrees-model.ts";
import { BUILD, DOCS, LEAD, project, row } from "./worktrees-fixtures.ts";

const many = (label: string, count: number, over = {}) =>
  Array.from({ length: count }, (_, i) => row(`${label}${String(i)}`, over));

describe("the Worktrees panel's counts", () => {
  it("say a branch has no worktree when worktrees are counted beside it", () => {
    const items = [
      ...many("ork/a/w", 2),
      ...many("ork/b/x", 4, { path: null }),
    ];
    expect(countWords(items)).toBe(
      "2 worktrees · 4 branches without a worktree",
    );
    expect(countSaid([project("app", items)], "app")).toBe(
      "2 worktrees and 4 branches without a worktree in app.",
    );
  });

  it("say just the branches when there are no worktrees", () => {
    const items = many("ork/b/x", 3, { path: null });
    expect(countWords(items)).toBe("3 branches");
  });

  it("word a filter's result as a sentence", () => {
    const items = [...many("ork/a/w", 4), DOCS];
    expect(countSaid([project("app", items)], "app")).toBe(
      "4 worktrees and 1 branch without a worktree in app.",
    );
    expect(countSaid([project("app", [BUILD, LEAD])], "app")).toBe(
      "2 worktrees in app.",
    );
  });
});

const ROOT = "/code/Jo's app";
const QUOTED_ROOT = String.raw`'/code/Jo'\''s app'`;

describe("the Worktrees panel's CLI twins", () => {
  it("run remove from the project's root, quoting the root and the key", () => {
    expect(removeTwin(ROOT, "/code/Jo's app-task", false, true)).toBe(
      `cd ${QUOTED_ROOT} && ork worktrees remove ${String.raw`'/code/Jo'\''s app-task'`} --force`,
    );
  });

  it("leave a plain root and branch as they are", () => {
    expect(removeTwin("/code/app", "ork/9b1e07/lead", true, false)).toBe(
      "cd /code/app && ork worktrees remove ork/9b1e07/lead --branch",
    );
  });

  it("run clean from the project's root, quoted", () => {
    expect(cleanTwin(ROOT, true)).toBe(
      `cd ${QUOTED_ROOT} && ork worktrees clean --branches`,
    );
  });
});
