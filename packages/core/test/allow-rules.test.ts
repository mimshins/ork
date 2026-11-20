/**
 * @file Tests for writing an "always" answer's rules to the project's rules
 *   file: this repository's own comment-rich `.ork/project.yaml` keeps every
 *   comment and untouched line, a missing file is created, a rule already there
 *   is skipped, and a write that fails throws.
 */

import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseProject } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { addAllowRules } from "../src/index.ts";

const REPO_RULES = readFileSync(
  new URL("../../../.ork/project.yaml", import.meta.url),
  "utf8",
);

const folder = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-allow-")));

const allowOf = (file: string): string[] | undefined => {
  const parsed = parseProject(readFileSync(file, "utf8"));
  return parsed.ok ? parsed.project.permissions?.allow : undefined;
};

describe("addAllowRules", () => {
  it("keeps every comment and line of this repository's rules file", () => {
    const file = path.join(folder(), "project.yaml");
    writeFileSync(file, REPO_RULES);
    addAllowRules(file, ["Bash(ork-allow-test one *)"]);
    const written = readFileSync(file, "utf8");
    expect(written.replace("    - Bash(ork-allow-test one *)\n", "")).toBe(
      REPO_RULES,
    );
    expect(allowOf(file)?.at(-1)).toBe("Bash(ork-allow-test one *)");
  });

  it("creates a missing file with its schema version", () => {
    const file = path.join(folder(), ".ork", "project.yaml");
    addAllowRules(file, ["Bash(git log *)", "Bash(jq *)"]);
    expect(readFileSync(file, "utf8")).toBe(
      "schemaVersion: 1\npermissions:\n  allow:\n    - Bash(git log *)\n    - Bash(jq *)\n",
    );
  });

  it("adds a permissions block to a file without one, keeping comments", () => {
    const file = path.join(folder(), "project.yaml");
    const text =
      "# Our rules.\nschemaVersion: 1 # always 1\ngit:\n  base: main\n";
    writeFileSync(file, text);
    addAllowRules(file, ["Bash(git log *)"]);
    expect(readFileSync(file, "utf8")).toBe(
      `${text}permissions:\n  allow:\n    - Bash(git log *)\n`,
    );
  });

  it("skips a rule already present and leaves the file alone", () => {
    const file = path.join(folder(), "project.yaml");
    writeFileSync(file, REPO_RULES);
    addAllowRules(file, ["Bash(git log *)", "Bash(git log *)"]);
    expect(readFileSync(file, "utf8")).toBe(REPO_RULES);
  });

  it("adds a new rule only once, beside one already present", () => {
    const file = path.join(folder(), "project.yaml");
    writeFileSync(
      file,
      "schemaVersion: 1\npermissions:\n  allow:\n    - Bash(ls *)\n",
    );
    addAllowRules(file, ["Bash(ls *)", "Bash(wc *)", "Bash(wc *)"]);
    expect(allowOf(file)).toEqual(["Bash(ls *)", "Bash(wc *)"]);
  });

  it("throws when the file can't be written", () => {
    const blocker = path.join(folder(), "not-a-folder");
    writeFileSync(blocker, "");
    expect(() => {
      addAllowRules(path.join(blocker, "project.yaml"), ["Bash(ls *)"]);
    }).toThrow(/EEXIST|ENOTDIR/u);
  });

  it("throws on a file that doesn't parse, and leaves it alone", () => {
    const file = path.join(folder(), "project.yaml");
    writeFileSync(file, "schemaVersion: [1\n");
    expect(() => {
      addAllowRules(file, ["Bash(ls *)"]);
    }).toThrow(/doesn't parse/u);
    expect(readFileSync(file, "utf8")).toBe("schemaVersion: [1\n");
  });
});
