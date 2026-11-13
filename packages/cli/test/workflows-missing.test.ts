/**
 * @file Tests for what a workflow argument that is no file says: the project's
 *   workflows by file name (and `name:` when it differs), and that a file name
 *   or path is meant.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { missingWorkflowText } from "../src/workflows.ts";

describe("missingWorkflowText", () => {
  it("lists the workflows, with the name when it differs from the file's", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-missing-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "build.ork.yaml"), "name: build\n");
    writeFileSync(path.join(dir, "ship.ork.yaml"), "name: release\n");
    writeFileSync(path.join(dir, "notes.md"), "name: nope\n");
    expect(missingWorkflowText("release", dir)).toBe(
      "no workflow file release; a file name or path is meant, not a workflow name (this project's workflows: build.ork.yaml, ship.ork.yaml (release))",
    );
  });

  it("says so when the project has none", () => {
    expect(missingWorkflowText("x", path.join(tmpdir(), "ork-none-"))).toBe(
      "no workflow file x; a file name or path is meant, not a workflow name (this project has no workflows)",
    );
  });
});
