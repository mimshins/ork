/**
 * @file Tests that `packages/cli/src/__build_info__.ts` matches the CLI's
 *   `package.json`, as `tools/release/build-info.ts` writes it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BUILD_INFO, buildInfo, cliPackage } from "../build-info.ts";

describe("the bound build info", () => {
  it("matches the CLI's package.json (run node tools/release/build-info.ts)", () => {
    const { name, version } = cliPackage();
    expect(readFileSync(BUILD_INFO, "utf8")).toBe(buildInfo(name, version));
  });
});
