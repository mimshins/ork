/**
 * @file Tests for the terminal a run asks its questions on: a detached run
 *   (`ORK_DETACHED=1`) has none, and says why in one line.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { terminalHuman } from "../src/commands/run.ts";

describe("the terminal of a detached run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is off, and a line says questions wait for ork decide", () => {
    vi.stubEnv("ORK_DETACHED", "1");
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      lines.push(String(chunk));
      return true;
    });

    expect(terminalHuman()).toBeUndefined();
    expect(lines.join("")).toContain("detached run: no terminal asks");
    expect(lines.join("")).toContain("ork decide");
  });
});
