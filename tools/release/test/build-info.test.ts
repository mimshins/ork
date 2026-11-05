/**
 * @file Tests that `packages/cli/src/__build_info__.ts` and the Claude Code
 *   plugins match the CLI's `package.json`, as `tools/release/build-info.ts`
 *   writes them.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUILD_INFO,
  buildInfo,
  cliPackage,
  PLUGIN_FILES,
  withVersion,
} from "../build-info.ts";

describe("the bound build info", () => {
  it("matches the CLI's package.json (run node tools/release/build-info.ts)", () => {
    const { name, version } = cliPackage();
    expect(readFileSync(BUILD_INFO, "utf8")).toBe(buildInfo(name, version));
  });

  it.each(PLUGIN_FILES)("binds the version into %s", file => {
    const text = readFileSync(file, "utf8");
    expect(text).toBe(withVersion(text, cliPackage().version));
  });

  it("binds both a plugin's version and what it expects", () => {
    expect(
      withVersion(
        '{ "version": "0.1.0", "args": ["mcp", "--expects", "0.1.0"] }',
        "1.2.3",
      ),
    ).toBe('{ "version": "1.2.3", "args": ["mcp", "--expects", "1.2.3"] }');
  });
});
