/**
 * @file The file-overview check: every source module starts with a JSDoc block
 *   that has an `@file` tag saying what the module is for. Part of `pnpm
 *   lint`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Source files the check reads; generated and vendored files are skipped. */
export const SOURCE = /\.(?:[cm]?[jt]s|d\.ts)$/u;
export const SKIPPED = [/(?:^|\/)node_modules\//u, /(?:^|\/)dist\//u];

/**
 * Whether `text` opens with a `/** … *\/` block containing `@file`, after an
 * optional shebang and blank lines.
 */
export const hasFileOverview = (text: string): boolean => {
  const body = text.replace(/^#![^\n]*\n/u, "").trimStart();
  if (!body.startsWith("/**")) return false;
  const end = body.indexOf("*/");
  return end !== -1 && /@file\s+\S/u.test(body.slice(0, end));
};

/** The tracked and untracked (not ignored) source files under `root`. */
export const sourceFiles = (root: string): string[] =>
  execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(f => SOURCE.test(f) && !SKIPPED.some(s => s.test(f)));

export const checkFileOverviews = (root: string): string[] =>
  sourceFiles(root).filter(
    f => !hasFileOverview(readFileSync(path.join(root, f), "utf8")),
  );

const main = (): void => {
  const root = path.resolve(import.meta.dirname, "../..");
  const missing = checkFileOverviews(root);
  if (missing.length > 0) {
    for (const file of missing) {
      process.stderr.write(
        `${file}: starts without a /** @file … */ overview\n`,
      );
    }
    process.stderr.write(
      `\n✗ ${String(missing.length)} file(s) need an @file overview.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write("✓ Every source file has an @file overview.\n");
};

if (import.meta.main) main();
