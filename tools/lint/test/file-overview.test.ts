/** @file Tests for the file-overview check. */

import { describe, expect, it } from "vitest";

import { hasFileOverview } from "../file-overview.ts";

describe("hasFileOverview", () => {
  it("accepts a leading @file block, after a shebang", () => {
    expect(
      hasFileOverview("/**\n * @file What this does.\n */\nexport {};\n"),
    ).toBe(true);
    expect(
      hasFileOverview("#!/usr/bin/env node\n/** @file The bin. */\n"),
    ).toBe(true);
  });

  it("rejects a missing, late or empty overview", () => {
    expect(hasFileOverview("export const a = 1;\n")).toBe(false);
    expect(hasFileOverview("// @file not JSDoc\n")).toBe(false);
    expect(hasFileOverview("/** A type. */\nexport type A = 1;\n")).toBe(false);
    expect(hasFileOverview('import "x";\n/** @file Too late. */\n')).toBe(
      false,
    );
    expect(hasFileOverview("/** @file */\n")).toBe(false);
  });
});
