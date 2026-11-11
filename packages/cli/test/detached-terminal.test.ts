/**
 * @file Tests for the terminal a run asks its questions on: a detached run
 *   (`ORK_DETACHED=1`) has none, and says why in one line; a foreground caller
 *   asks a called run's questions only with a terminal on stdin; `--detach`
 *   points to `ork attach` first.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { terminalHuman } from "../src/commands/run.ts";
import { callsShown, createTerminalHuman } from "../src/human.ts";
import { detachHint } from "../src/output.ts";

describe("the terminal of a detached run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is off, and a line says questions wait for ork attach or ork decide", () => {
    vi.stubEnv("ORK_DETACHED", "1");
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      lines.push(String(chunk));
      return true;
    });

    expect(terminalHuman()).toBeUndefined();
    expect(lines.join("")).toContain("detached run: no terminal asks");
    expect(lines.join("")).toContain("ork attach or ork decide");
  });
});

describe("a foreground caller's called runs", () => {
  const human = createTerminalHuman({
    input: process.stdin,
    output: process.stderr,
    interactive: false,
  });

  it("asks their questions when stdin is a terminal", () => {
    expect(callsShown(human, true)).toEqual({ ask: human });
  });

  it("never asks them without a terminal on stdin", () => {
    expect(callsShown(human, false)).toEqual({});
    expect(callsShown(human)).toEqual({});
  });
});

describe("the hint of `ork run --detach`", () => {
  it("starts with ork attach, then ork logs -f", () => {
    expect(detachHint("3f2a91c0")).toMatch(
      /^ork attach 3f2a91c0 · ork logs 3f2a91c0 -f · /u,
    );
    expect(detachHint("3f2a91c0")).toContain("ork stop 3f2a91c0");
  });
});
