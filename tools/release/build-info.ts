/**
 * @file Binds the CLI's name and version into
 *   `packages/cli/src/__build_info__.ts` from its `package.json`, so `ork
 *   --version` and feedback origins read a constant in the sources and in the
 *   bundle alike. Runs after `changeset version` bumps the package and before
 *   every build. Usage: `node tools/release/build-info.ts`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CLI = path.resolve(import.meta.dirname, "../../packages/cli");

export const BUILD_INFO = path.join(CLI, "src", "__build_info__.ts");

/** The `__build_info__.ts` source for a package `name` at `version`. */
export const buildInfo = (name: string, version: string): string =>
  [
    "/**",
    " * @file The published package's name and version, bound to",
    " *   `packages/cli/package.json`. Do not edit by hand: `pnpm changesets:version`",
    " *   and `pnpm build` rewrite it (`tools/release/build-info.ts`), and a test",
    " *   fails when it is stale.",
    " */",
    "",
    `export const ORK_NAME = ${JSON.stringify(name)};`,
    `export const ORK_VERSION = ${JSON.stringify(version)};`,
    "",
  ].join("\n");

/** The CLI's `package.json` name and version. */
export const cliPackage = (): { name: string; version: string } => {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(CLI, "package.json"), "utf8"),
  );
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "name" in parsed &&
    typeof parsed.name === "string" &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return { name: parsed.name, version: parsed.version };
  }
  throw new Error("packages/cli/package.json has no name or version");
};

if (import.meta.main) {
  const { name, version } = cliPackage();
  const source = buildInfo(name, version);
  if (readFileSync(BUILD_INFO, "utf8") !== source) {
    writeFileSync(BUILD_INFO, source);
  }
  process.stdout.write(`Bound ${name}@${version}\n`);
}
