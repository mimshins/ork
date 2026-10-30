/**
 * @file The entry-point check: `index.ts` is only a package's entry point,
 *   `packages/<name>/src/index.ts`, and it only re-exports the package's public
 *   pieces. Logic lives in named modules; a folder inside a package has no
 *   barrel. Part of `pnpm lint`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { sourceFiles } from "./file-overview.ts";

const INDEX = /(?:^|\/)index\.[cm]?[jt]s$/u;
const ENTRY = /^packages\/[^/]+\/src\/index\.ts$/u;
const RE_EXPORT = /^export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+"[^"]+"$/u;

/** The statements of `text` that are not `export … from "…"`, comments aside. */
export const nonReExports = (text: string): string[] =>
  text
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/^\s*\/\/[^\n]*$/gmu, "")
    .split(";")
    .map(statement => statement.trim().replaceAll(/\s+/gu, " "))
    .filter(statement => statement !== "" && !RE_EXPORT.test(statement));

/** Each problem with an `index` file among `files` under `root`. */
export const checkEntryPoints = (
  root: string,
  files: readonly string[],
): string[] =>
  files
    .filter(f => INDEX.test(f))
    .flatMap(f => {
      if (!ENTRY.test(f)) {
        return [
          `${f}: index.ts is only a package's entry point (packages/<name>/src/index.ts); name this module for what it does`,
        ];
      }
      const [first] = nonReExports(readFileSync(path.join(root, f), "utf8"));
      return first === undefined
        ? []
        : [
            `${f}: an entry point only re-exports; move \`${first.slice(0, 60)}\` into a named module`,
          ];
    });

const main = (): void => {
  const root = path.resolve(import.meta.dirname, "../..");
  const problems = checkEntryPoints(root, sourceFiles(root));
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.stderr.write(
      `\n✗ ${String(problems.length)} index file(s) to fix.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "✓ Every index.ts is a package entry that re-exports.\n",
  );
};

if (import.meta.main) main();
