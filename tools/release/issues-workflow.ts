/**
 * @file Bundles the `issues` example (`examples/issues.ork.yaml`) into the CLI
 *   as text, in `packages/cli/src/project/issues-workflow.ts`, so `ork init`
 *   can offer it from the one bundled CLI. Runs before every build; a test
 *   fails when the module is stale. Usage: `node
 *   tools/release/issues-workflow.ts`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export const ISSUES_FILE = path.join(ROOT, "examples", "issues.ork.yaml");

export const ISSUES_MODULE = path.join(
  ROOT,
  "packages",
  "cli",
  "src",
  "project",
  "issues-workflow.ts",
);

/** The module's source for the example at `file`. */
export const issuesModule = (file = ISSUES_FILE): string =>
  [
    "/**",
    " * @file The `issues` example (`examples/issues.ork.yaml`) as text, for `ork",
    " *   init`. Do not edit by hand: `node tools/release/issues-workflow.ts` and",
    " *   `pnpm build` rewrite it, and a test fails when it is stale.",
    " */",
    "",
    "export const ISSUES_WORKFLOW =",
    `  ${JSON.stringify(readFileSync(file, "utf8"))};`,
    "",
  ].join("\n");

if (import.meta.main) {
  const source = issuesModule();
  let current = "";
  try {
    current = readFileSync(ISSUES_MODULE, "utf8");
  } catch {
    current = "";
  }
  if (current !== source) writeFileSync(ISSUES_MODULE, source);
  process.stdout.write(`Bundled the issues example into ${ISSUES_MODULE}\n`);
}
