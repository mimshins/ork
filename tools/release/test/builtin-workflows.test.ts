/**
 * @file Tests that the core's bundled copy of the built-in workflows matches
 *   `packages/core/workflows/`, as `tools/release/builtin-workflows.ts` writes
 *   it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORKFLOWS_MODULE, workflowsModule } from "../builtin-workflows.ts";

describe("the bundled built-in workflows", () => {
  it("match packages/core/workflows/ (run node tools/release/builtin-workflows.ts)", () => {
    expect(readFileSync(WORKFLOWS_MODULE, "utf8")).toBe(workflowsModule());
  });
});
