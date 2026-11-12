/**
 * @file Tests that the CLI's bundled copy of the `issues` example matches
 *   `examples/issues.ork.yaml`, as `tools/release/issues-workflow.ts` writes
 *   it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ISSUES_MODULE, issuesModule } from "../issues-workflow.ts";

describe("the bundled issues workflow", () => {
  it("matches examples/issues.ork.yaml (run node tools/release/issues-workflow.ts)", () => {
    expect(readFileSync(ISSUES_MODULE, "utf8")).toBe(issuesModule());
  });
});
