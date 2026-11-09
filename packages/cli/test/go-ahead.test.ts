/**
 * @file Tests for the question `ork worktrees clean` and `remove` ask: `--yes`
 *   skips it, no terminal needs `--yes`, a yes goes ahead, and a no says
 *   `Cancelled.` instead of leaving the command silent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { goAhead } from "../src/project/go-ahead.ts";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const printed = () => {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return { out, err };
};

describe("goAhead", () => {
  it("skips the question with --yes", async () => {
    expect(
      await goAhead(true, "clean", false, () => Promise.resolve(false)),
    ).toBe(true);
  });

  it("asks for --yes without a terminal", async () => {
    const { err } = printed();
    expect(await goAhead(false, "clean", false)).toBe(false);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to clean without a terminal."),
    );
    expect(process.exitCode).toBe(1);
  });

  it("goes ahead on a yes", async () => {
    expect(
      await goAhead(false, "clean", true, () => Promise.resolve(true)),
    ).toBe(true);
  });

  it("says Cancelled. on a no", async () => {
    const { out } = printed();
    expect(
      await goAhead(false, "remove", true, () => Promise.resolve(false)),
    ).toBe(false);
    expect(out).toHaveBeenCalledWith("Cancelled.\n");
    expect(process.exitCode).toBeUndefined();
  });
});
