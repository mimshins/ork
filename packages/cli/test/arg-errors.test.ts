/**
 * @file `ork` as a process, on an argument error: a command with no subcommands
 *   prints its one-line message and no help; a group, an unknown command and
 *   `--help` still print help (specs/cli/list-filters.md).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";

describe("an argument error, as a process", () => {
  const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

  /** Runs `ork` with `args` in a throwaway home. */
  const ork = (...args: string[]) => {
    const home = mkdtempSync(path.join(tmpdir(), "ork-help-"));
    const ran = spawnSync(process.execPath, [BIN, ...args], {
      cwd: home,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        ORK_PLAIN: "1",
        ORK_NO_UPDATE_CHECK: "1",
      },
    });
    return {
      out: stripVTControlCharacters(ran.stdout),
      err: stripVTControlCharacters(ran.stderr),
      code: ran.status,
    };
  };

  it.each([["ps", "--status", "bogus"], ["ps", "--bogus"], ["prune"]])(
    "prints one line, no help, for %j",
    (...args) => {
      const ran = ork(...args);
      expect(ran.code).toBe(1);
      expect(ran.out).toBe("");
      expect(ran.err.trim().split("\n")).toHaveLength(1);
    },
  );

  // Every command that takes a fixed number of words, given its words and one more.
  it.each([
    ["follow-ups", "show", "a"],
    ["follow-ups", "post", "a"],
    ["follow-ups", "published", "a"],
    ["follow-ups", "list"],
    ["pause", "a"],
    ["continue", "a"],
    ["attach", "a"],
    ["stop", "a"],
    ["resume", "a"],
    ["feedback", "show", "a"],
    ["feedback", "note", "-m", "x", "a", "b"],
    ["feedback", "accept", "a"],
    ["feedback", "dismiss", "a"],
    ["feedback", "restore", "a"],
    ["feedback", "apply", "a"],
    ["feedback", "split", "a"],
    ["feedback", "publish", "a"],
    ["feedback", "import", "a"],
    ["projects", "forget", "a"],
    ["projects", "move", "a", "b"],
  ])("refuses a word too many after %j", (...args) => {
    const ran = ork(...args, "extra");
    expect(ran.code).toBe(1);
    expect(ran.out).toBe("");
    expect(ran.err.trim()).toBe("Unexpected argument `extra`.");
  });

  it("still takes trailing words where a command is built for them", () => {
    const ran = ork("validate", "a.ork.yaml", "b.ork.yaml");
    expect(ran.err).not.toContain("Unexpected argument");
  });

  it("says what is missing", () => {
    expect(ork("prune").err).toContain("Missing required argument");
  });

  it.each([["follow-ups"], ["nope"]])("prints help for %j", (...args) => {
    const ran = ork(...args);
    expect(ran.code).toBe(1);
    expect(ran.out).toMatch(/usage/iu);
  });

  it.each([
    ["ps", "--help"],
    ["ps", "-h"],
    ["prune", "--help"],
  ])("prints help for %j", (...args) => {
    const ran = ork(...args);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("USAGE");
  });
});
