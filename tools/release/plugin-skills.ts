/**
 * @file Bundles the Claude Code plugin's skills (`plugins/ork/skills/`) into
 *   the CLI as text, in `packages/cli/src/project/ork-skills.ts`, so `ork init
 *   --skills` can write them into a project from the one bundled CLI (RFC-012).
 *   Runs before every build; a test fails when the module is stale. Usage:
 *   `node tools/release/plugin-skills.ts`.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export const SKILLS_DIR = path.join(ROOT, "plugins", "ork", "skills");

export const SKILLS_MODULE = path.join(
  ROOT,
  "packages",
  "cli",
  "src",
  "project",
  "ork-skills.ts",
);

/** The module's source for the skills in `dir`, by name, in name order. */
export const skillsModule = (dir = SKILLS_DIR): string => {
  const entries = readdirSync(dir)
    .toSorted()
    .map(name => {
      const text = readFileSync(path.join(dir, name, "SKILL.md"), "utf8");
      return `  ${name}: ${JSON.stringify(text)},`;
    });
  return [
    "/**",
    " * @file The Claude Code plugin's skills (`plugins/ork/skills/`) as text, by",
    " *   name, for `ork init --skills` (RFC-012). Do not edit by hand:",
    " *   `node tools/release/plugin-skills.ts` and `pnpm build` rewrite it, and a",
    " *   test fails when it is stale.",
    " */",
    "",
    "export const ORK_SKILLS: Readonly<Record<string, string>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
};

if (import.meta.main) {
  const source = skillsModule();
  let current = "";
  try {
    current = readFileSync(SKILLS_MODULE, "utf8");
  } catch {
    current = "";
  }
  if (current !== source) writeFileSync(SKILLS_MODULE, source);
  process.stdout.write(`Bundled the plugin's skills into ${SKILLS_MODULE}\n`);
}
