/** @file Tests for the entry-point check. */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkEntryPoints, nonReExports } from "../entry-points.ts";

const ENTRY = [
  "/**",
  " * @file The package's public surface.",
  " */",
  "",
  'export * from "./a.ts";',
  'export type * from "./types.ts";',
  "export {",
  "  b,",
  "  type C,",
  '} from "./b.ts";',
  "",
].join("\n");

/** A scratch repo holding `files`, checked as the lint check would. */
const check = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-entry-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return checkEntryPoints(root, Object.keys(files));
};

describe("nonReExports", () => {
  it("accepts re-exports, with comments", () => {
    expect(nonReExports(ENTRY)).toEqual([]);
  });

  it("names anything else", () => {
    expect(
      nonReExports('import { a } from "./a.ts";\nexport const b = a;\n'),
    ).toEqual(['import { a } from "./a.ts"', "export const b = a"]);
  });
});

describe("checkEntryPoints", () => {
  it("accepts a package entry that only re-exports", () => {
    expect(
      check({ "packages/core/src/index.ts": ENTRY, "tools/x.ts": "1;" }),
    ).toEqual([]);
  });

  it("rejects a barrel inside a package and logic in an entry", () => {
    const problems = check({
      "packages/core/src/store/index.ts": ENTRY,
      "packages/nodes/src/index.ts": `${ENTRY}export const x = 1;\n`,
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("only a package's entry point");
    expect(problems[1]).toContain("move `export const x = 1`");
  });
});
