/**
 * @file Bundles Ork's built-in workflows (`packages/core/workflows/`) into the
 *   core as text, in `packages/core/src/project/builtin-workflows.ts`, so the
 *   one bundled CLI can run `ork:<name>` without shipping files beside it. Runs
 *   before every build; a test fails when the module is stale. Usage: `node
 *   tools/release/builtin-workflows.ts`.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

const SUFFIX = ".ork.yaml";

export const WORKFLOWS_DIR = path.join(ROOT, "packages", "core", "workflows");

export const WORKFLOWS_MODULE = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "project",
  "builtin-workflows.ts",
);

/** The module's source for the workflows in `dir`, by name, in name order. */
export const workflowsModule = (dir = WORKFLOWS_DIR): string => {
  const entries = readdirSync(dir)
    .filter(name => name.endsWith(SUFFIX))
    .toSorted()
    .map(name => {
      const text = readFileSync(path.join(dir, name), "utf8");
      // As the formatter lays out a long value: on its own line.
      return `  ${JSON.stringify(name.slice(0, -SUFFIX.length))}:\n    ${JSON.stringify(text)},`;
    });
  return [
    "/**",
    " * @file Ork's built-in workflows (`packages/core/workflows/`) as text, by name,",
    " *   run as `ork:<name>`. Do not edit by hand: `node",
    " *   tools/release/builtin-workflows.ts` and `pnpm build` rewrite it, and a test",
    " *   fails when it is stale.",
    " */",
    "",
    "export const BUILTIN_WORKFLOWS: Readonly<Record<string, string>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
};

if (import.meta.main) {
  const source = workflowsModule();
  let current = "";
  try {
    current = readFileSync(WORKFLOWS_MODULE, "utf8");
  } catch {
    current = "";
  }
  if (current !== source) writeFileSync(WORKFLOWS_MODULE, source);
  process.stdout.write(
    `Bundled the built-in workflows into ${WORKFLOWS_MODULE}\n`,
  );
}
