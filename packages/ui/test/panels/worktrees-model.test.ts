/**
 * @file Tests for the Worktrees panel's CLI twins: each runs from the project's
 *   root, and a root or a key with a space or a quote is quoted, so a person
 *   who pastes it runs exactly what the panel would have done.
 */

import { describe, expect, it } from "vitest";

import { cleanTwin, removeTwin } from "../../src/panels/worktrees-model.ts";

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
