/**
 * @file Tests for the `extract` tool: offered on every driver when the session
 *   has a folder, refusing paths out of it, denied files and flag-shaped
 *   values, holding its steps to a producer then cuts, and returning a capped,
 *   paged result with the footer. A paused run or node holds an `extract` call
 *   as it holds `read_input`: the hold is the driver's hook on every tool call
 *   (Claude Code's `PreToolUse` with matcher `*`, Command Code's mod,
 *   OpenCode's rules), and the tool has no code of its own for it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { HumanChannel } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { orkTools, preapprovedTools } from "../src/index.ts";
import { EXTRACT_CAP } from "../src/tools/extract.ts";

const human: HumanChannel = {
  ask: () => Promise.resolve(""),
  permit: () => Promise.resolve({ allow: true }),
};

const DRIVERS: readonly Driver[] = ["claude-code", "open-code", "command-code"];

const toolsOf = (driver: Driver, cwd?: string, denyRead?: string[]) =>
  orkTools({
    nodeId: "build",
    driver,
    ports: { human },
    ...(cwd === undefined ? {} : { cwd }),
    ...(denyRead === undefined ? {} : { denyRead }),
  });

const extractOf = (driver: Driver, cwd?: string, denyRead?: string[]) =>
  toolsOf(driver, cwd, denyRead).find(tool => tool.name === "extract");

/** Line `n` of the 100 KB file. */
const bigLine = (n: number): string => `line ${String(n)} ${"x".repeat(40)}`;

/** A git repository with a committed `a.ts` and `.env`. */
const repo = (): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-extract-tool-"));
  writeFileSync(path.join(cwd, "a.ts"), "one\ntwo\nthree\n");
  writeFileSync(path.join(cwd, ".env"), "SECRET=x\n");
  execFileSync("git", ["init", "-q"], { cwd });
  return cwd;
};

/** What a call says, and whether it was an error. */
const call = async (
  cwd: string,
  args: unknown,
  denyRead?: string[],
): Promise<{ said: string; isError: boolean }> => {
  const result = await extractOf("claude-code", cwd, denyRead)?.call(args);
  return {
    said: result?.content.map(part => part.text).join("") ?? "",
    isError: result?.isError === true,
  };
};

const read = (file: string, from?: number, to?: number) => ({
  step: "read",
  path: file,
  ...(from === undefined ? {} : { from }),
  ...(to === undefined ? {} : { to }),
});

describe("extract is offered", () => {
  it.each(DRIVERS)("on %s, when the session has a folder", driver => {
    expect(preapprovedTools(toolsOf(driver, repo()))).toContain(
      "mcp__ork__extract",
    );
  });

  it.each(DRIVERS)("not on %s without a folder", driver => {
    expect(extractOf(driver)).toBeUndefined();
  });
});

describe("extract refuses", () => {
  it("a symlink out of the folder, naming the path only", async () => {
    const cwd = repo();
    const outside = mkdtempSync(path.join(tmpdir(), "ork-outside-"));
    writeFileSync(path.join(outside, "x.txt"), "outside\n");
    symlinkSync(path.join(outside, "x.txt"), path.join(cwd, "link.txt"));
    expect(await call(cwd, { steps: [read("link.txt")] })).toEqual({
      said: "refused: link.txt (outside the folder)",
      isError: true,
    });
  });

  it("a denied file, built in or by the session's Read rules", async () => {
    const cwd = repo();
    expect(await call(cwd, { steps: [read(".env")] })).toEqual({
      said: "refused: .env",
      isError: true,
    });
    expect(await call(cwd, { steps: [read("a.ts")] }, ["*.ts"])).toEqual({
      said: "refused: a.ts",
      isError: true,
    });
  });

  it("a flag-shaped ref and a path with git's magic", async () => {
    const cwd = repo();
    const ref = await call(cwd, {
      steps: [{ step: "git", op: "show", ref: "--output=x" }],
    });
    const magic = await call(cwd, {
      steps: [{ step: "git", op: "diff", path: ":(top)x" }],
    });
    expect(ref.said).toContain("refused: ref --output=x");
    expect(magic.said).toContain("refused: :(top)x");
    expect([ref.isError, magic.isError]).toEqual([true, true]);
  });

  it("steps that don't start with a producer, or are too many or unknown", async () => {
    const cwd = repo();
    const cutFirst = await call(cwd, { steps: [{ step: "head", lines: 1 }] });
    const twoProducers = await call(cwd, {
      steps: [read("a.ts"), read("a.ts")],
    });
    const seven = await call(cwd, {
      steps: [
        read("a.ts"),
        ...Array.from({ length: 6 }, () => ({ step: "head", lines: 1 })),
      ],
    });
    const unknown = await call(cwd, { steps: [{ step: "cat", path: "a.ts" }] });
    expect(cutFirst.said).toContain(
      "the first step must be read, files, search or git",
    );
    expect(twoProducers.said).toContain("only the first step");
    expect(seven.said).toBe("steps: Too big: expected array to have <=6 items");
    expect(unknown.said).toContain("steps[0].step: Invalid discriminator");
    expect(
      [cutFirst, twoProducers, seven, unknown].map(result => result.isError),
    ).toEqual([true, true, true, true]);
  });
});

describe("extract returns", () => {
  it("a range of a 100 KB file, with the footer counting the producer's output", async () => {
    const cwd = repo();
    const big = Array.from({ length: 2000 }, (_, i) => bigLine(i + 1));
    writeFileSync(path.join(cwd, "big.txt"), `${big.join("\n")}\n`);
    const range = `10: ${bigLine(10)}\n11: ${bigLine(11)}`;
    expect(await call(cwd, { steps: [read("big.txt", 10, 11)] })).toEqual({
      said: `${range}\n[extract: read ${String(range.length)} characters, returned ${String(range.length)}]`,
      isError: false,
    });
  });

  it("the cut's output, while the footer counts what the producer read", async () => {
    const cwd = repo();
    const whole = "1: one\n2: two\n3: three";
    expect(
      await call(cwd, {
        steps: [read("a.ts"), { step: "match", text: "two" }],
      }),
    ).toEqual({
      said: `2: two\n[extract: read ${String(whole.length)} characters, returned 6]`,
      isError: false,
    });
  });

  it("at most the cap, saying where it cut and how to go on, then the rest from `from`", async () => {
    const cwd = repo();
    writeFileSync(
      path.join(cwd, "wide.txt"),
      `${"y".repeat(EXTRACT_CAP + 500)}\n`,
    );
    const whole = EXTRACT_CAP + 503;
    const first = await call(cwd, { steps: [read("wide.txt")] });
    const rest = await call(cwd, {
      steps: [read("wide.txt")],
      from: EXTRACT_CAP,
    });
    expect(first.said.split("\n").slice(1)).toEqual([
      `[cut at characters 0–${String(EXTRACT_CAP)} of ${String(whole)}: add a head, tail or match step, or call extract again with from: ${String(EXTRACT_CAP)}]`,
      `[extract: read ${String(whole)} characters, returned ${String(EXTRACT_CAP)}]`,
    ]);
    expect(rest.said).toBe(
      `${"y".repeat(503)}\n[characters ${String(EXTRACT_CAP)}–${String(whole)} of ${String(whole)}: the end]\n[extract: read ${String(whole)} characters, returned 503]`,
    );
  });

  it("only the footer when nothing is left", async () => {
    const cwd = repo();
    expect(
      await call(cwd, {
        steps: [read("a.ts"), { step: "match", text: "zzz" }],
      }),
    ).toEqual({
      said: "[extract: read 22 characters, returned 0]",
      isError: false,
    });
  });
});

describe("extract runs several programs in one call (RFC-025)", () => {
  it("returns each program's result under its own header, with one footer", async () => {
    const cwd = repo();
    const result = await call(cwd, {
      programs: [
        [read("a.ts", 2, 2)],
        [{ step: "files" }, { step: "count" }],
        [read("nope.ts")],
      ],
    });
    expect(result.said.split("\n")).toEqual([
      "### 1. read a.ts:2-2",
      "2: two",
      "",
      "### 2. files .",
      "1 lines",
      "",
      "### 3. read nope.ts",
      "[error: no such file: nope.ts]",
      expect.stringMatching(
        /^\[extract: read \d+ characters, returned \d+\]$/u,
      ),
    ]);
    expect(result.isError).toBe(false);
  });

  it("refuses both steps and programs, and neither", async () => {
    const cwd = repo();
    const both = await call(cwd, {
      steps: [read("a.ts")],
      programs: [[read("a.ts")]],
    });
    const neither = await call(cwd, {});
    expect([both, neither]).toEqual([
      {
        said: "give either steps (one program) or programs, not both",
        isError: true,
      },
      {
        said: "give either steps (one program) or programs, not both",
        isError: true,
      },
    ]);
  });
});
