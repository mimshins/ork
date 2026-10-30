/**
 * @file Fails a pull request that changes shipped code without a changeset.
 *   Every `@krapht/ork-*` package is bundled into `@krapht/ork`, so a change
 *   under any `packages/<name>/src/` or `package.json` needs one; an empty
 *   changeset (`pnpm changesets:empty`) says "nothing to release". Usage: `node
 *   tools/release/check-changeset.ts [base]` (default `origin/main`).
 */

import { execFileSync } from "node:child_process";

const SHIPPED = /^packages\/[^/]+\/(src\/|package\.json$|tsdown\.config\.ts$)/u;
const CHANGESET = /^\.changeset\/(?!README\.md$)[^/]+\.md$/u;

export const needsChangeset = (changed: readonly string[]): boolean =>
  changed.some(file => SHIPPED.test(file)) &&
  !changed.some(file => CHANGESET.test(file));

const main = (): void => {
  const base = process.argv[2] ?? "origin/main";
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(line => line !== "");
  if (needsChangeset(changed)) {
    process.stderr.write(
      "This change touches shipped code but adds no changeset.\nRun `pnpm changesets:create` (or `pnpm changesets:empty` for an internal-only change).\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write("✓ Changesets are in order.\n");
};

if (import.meta.main) main();
