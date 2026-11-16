/**
 * @file Tests that the core's bundled copies of the built-in workflows and
 *   their companion files match their sources, as
 *   `tools/release/builtin-workflows.ts` writes them, and that no companion
 *   points into this repository.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUNDLES_MODULE,
  bundlesModule,
  companionsOf,
  WORKFLOWS_MODULE,
  workflowsModule,
} from "../builtin-workflows.ts";

const REPO_PATHS = /\.ai\/skills|tools\/audit|\.ork\/context|packages\/core/u;

describe("the bundled built-in workflows", () => {
  it("match packages/core/workflows/ (run node tools/release/builtin-workflows.ts)", () => {
    expect(readFileSync(WORKFLOWS_MODULE, "utf8")).toBe(workflowsModule());
  });

  it("carry their companion files as their sources are (run the same)", () => {
    expect(readFileSync(BUNDLES_MODULE, "utf8")).toBe(bundlesModule());
  });

  it("bundle the audit's skill, scripts, rule and secret list", () => {
    const files = companionsOf("security-audit").map(([file]) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        "security-audit/cli.ts",
        "security-audit/package.json",
        "security-audit/context/read-only-bash.md",
        "security-audit/secret-patterns.ts",
        "security-audit/skill/LICENSE",
        "security-audit/skill/SKILL.md",
        "security-audit/skill/validate-findings.cjs",
      ]),
    );
    expect(files.filter(file => /test|PROVENANCE/u.test(file))).toEqual([]);
  });

  it("leave no path into this repository in the audit's bundle", () => {
    const texts = [
      readFileSync(
        new URL(
          "../../../packages/core/workflows/security-audit.ork.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
      ...companionsOf("security-audit").map(([, text]) => text),
    ];
    expect(texts.filter(text => REPO_PATHS.test(text))).toEqual([]);
  });
});
