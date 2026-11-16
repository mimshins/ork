/**
 * @file Fails when a changeset names a package that isn't published. Only
 *   `@krapht/ork` is; every `@krapht/ork-*` package is private and bundled into
 *   it, and Changesets refuses a changeset that mixes the two ("Found mixed
 *   changeset"), which stops the release job on main. Run by `pnpm lint`, so a
 *   build's `check:fast` catches it before it publishes. Usage: `node
 *   tools/release/changeset-names.ts`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The package names a changeset's front matter bumps. */
export const namesIn = (text: string): string[] => {
  const front = /^---\n([\s\S]*?)\n---/u.exec(text)?.[1] ?? "";
  return [...front.matchAll(/^\s*["']?([^"':\s]+)["']?\s*:/gmu)].map(
    match => match[1] ?? "",
  );
};

/** The workspace's packages that are published: not `private`. */
const published = (): Set<string> => {
  const dir = path.join(ROOT, "packages");
  const names = readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name, "package.json");
    // A leftover folder (built output, no manifest) is no package.
    if (!existsSync(file)) return [];
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof manifest !== "object" || manifest === null) return [];
    const id =
      "name" in manifest && typeof manifest.name === "string"
        ? manifest.name
        : undefined;
    const hidden = "private" in manifest && manifest.private === true;
    return id === undefined || hidden ? [] : [id];
  });
  return new Set(names);
};

/** Each changeset and the names it bumps that aren't published. */
export const unpublishedIn = (
  changesets: readonly { file: string; text: string }[],
  publishedNames: ReadonlySet<string>,
): { file: string; names: string[] }[] =>
  changesets
    .map(({ file, text }) => ({
      file,
      names: namesIn(text).filter(name => !publishedNames.has(name)),
    }))
    .filter(({ names }) => names.length > 0);

const main = (): void => {
  const dir = path.join(ROOT, ".changeset");
  const changesets = readdirSync(dir)
    .filter(file => file.endsWith(".md") && file !== "README.md")
    .map(file => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));
  const wrong = unpublishedIn(changesets, published());
  if (wrong.length === 0) return;
  for (const { file, names } of wrong) {
    process.stderr.write(
      `.changeset/${file} names ${names.join(", ")}, which isn't published: name only @krapht/ork, which bundles it.\n`,
    );
  }
  process.exitCode = 1;
};

if (import.meta.main) main();
