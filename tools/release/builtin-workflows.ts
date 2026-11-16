/**
 * @file Bundles Ork's built-in workflows (`packages/core/workflows/`) into the
 *   core as text, in `packages/core/src/project/builtin-workflows.ts`, and
 *   their companion files in `packages/core/src/project/builtin-bundles.ts`, so
 *   the one bundled CLI can run `ork:<name>` without shipping files beside it.
 *   A workflow's companions are its folder `workflows/<name>/` plus the sources
 *   `SOURCES` names, at the same paths in the bundle, with `REWRITES` applied
 *   on copy. Runs before every build; a test fails when a module is stale.
 *   Usage: `node tools/release/builtin-workflows.ts`.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

const SUFFIX = ".ork.yaml";

export const WORKFLOWS_DIR = path.join(ROOT, "packages", "core", "workflows");

const PROJECT_DIR = path.join(ROOT, "packages", "core", "src", "project");

export const WORKFLOWS_MODULE = path.join(PROJECT_DIR, "builtin-workflows.ts");

export const BUNDLES_MODULE = path.join(PROJECT_DIR, "builtin-bundles.ts");

/**
 * A source of companion files: a folder (its own files, not its subfolders) or
 * one file, from the repository root; where it goes in the bundle; and which
 * file names it keeps.
 */
type Source = { from: string; to: string; keep?: (name: string) => boolean };

/** Companion sources beyond a built-in's own folder, by built-in name. */
const SOURCES: Readonly<Record<string, readonly Source[]>> = {
  "security-audit": [
    {
      // The vendored skill, byte for byte, without its tests and provenance.
      from: ".ai/skills/security-audit",
      to: "security-audit/skill",
      keep: name => !name.endsWith(".test.cjs") && name !== "PROVENANCE.md",
    },
    {
      from: "tools/audit",
      to: "security-audit",
      keep: name => name.endsWith(".ts"),
    },
    {
      from: "packages/core/src/store/secret-patterns.ts",
      to: "security-audit/secret-patterns.ts",
    },
  ],
};

/**
 * Exact text replaced in a companion on copy, by its path in the bundle: what
 * points into this repository points into the bundle instead.
 */
const REWRITES: Readonly<
  Record<string, readonly (readonly [string, string])[]>
> = {
  "security-audit/scan.ts": [
    [
      [
        "// The package's entry point by path: `tools/` has no workspace link to it.",
        "import {",
        "  SECRET_PATTERNS,",
        "  type SecretPattern,",
        '} from "../../packages/core/src/index.ts";',
      ].join("\n"),
      [
        "// The core's list, copied beside this script when Ork bundles it.",
        'import { SECRET_PATTERNS, type SecretPattern } from "./secret-patterns.ts";',
      ].join("\n"),
    ],
  ],
  "security-audit/verdicts.ts": [
    ['"../../.ai/skills/security-audit"', '"skill"'],
  ],
};

/** `text` with the rewrites for `file`; throws when one no longer matches. */
const rewritten = (file: string, text: string): string =>
  (REWRITES[file] ?? []).reduce((done, [from, to]) => {
    if (!done.includes(from)) {
      throw new Error(`${file} no longer has the text the bundle rewrites`);
    }
    return done.replaceAll(from, to);
  }, text);

/**
 * The files of `dir` and its subfolders, as paths relative to it, without a
 * dotfile or a file in a dot folder (`.DS_Store` is not part of a bundle).
 */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter(name => !name.split(path.sep).some(part => part.startsWith(".")))
    .filter(name => statSync(path.join(dir, name)).isFile())
    .map(name => name.split(path.sep).join("/"));

/** A built-in's companion files, by path in its bundle, in path order. */
export const companionsOf = (
  name: string,
  dir = WORKFLOWS_DIR,
  root = ROOT,
): [string, string][] => {
  const own = path.join(dir, name);
  const files: [string, string][] = (
    existsSync(own) ? filesUnder(own) : []
  ).map(file => [
    `${name}/${file}`,
    readFileSync(path.join(own, file), "utf8"),
  ]);
  for (const { from, to, keep = () => true } of SOURCES[name] ?? []) {
    const source = path.join(root, from);
    if (statSync(source).isFile()) {
      files.push([to, readFileSync(source, "utf8")]);
      continue;
    }
    for (const file of readdirSync(source).toSorted()) {
      const at = path.join(source, file);
      if (!file.startsWith(".") && keep(file) && statSync(at).isFile()) {
        files.push([`${to}/${file}`, readFileSync(at, "utf8")]);
      }
    }
  }
  return files
    .map(([file, text]): [string, string] => [file, rewritten(file, text)])
    .toSorted(([a], [b]) => (a < b ? -1 : 1));
};

/** The built-ins' names in `dir`, in name order. */
const namesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter(name => name.endsWith(SUFFIX))
    .map(name => name.slice(0, -SUFFIX.length))
    .toSorted();

/** The module's source for the workflows in `dir`, by name, in name order. */
export const workflowsModule = (dir = WORKFLOWS_DIR): string => {
  const entries = namesIn(dir).map(name => {
    const text = readFileSync(path.join(dir, `${name}${SUFFIX}`), "utf8");
    // As the formatter lays out a long value: on its own line.
    return `  ${JSON.stringify(name)}:\n    ${JSON.stringify(text)},`;
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

/**
 * The module's source for the companion files of the workflows in `dir`, for
 * those that have any (oxfmt leaves this module as written).
 */
export const bundlesModule = (dir = WORKFLOWS_DIR, root = ROOT): string => {
  const entries = namesIn(dir).flatMap(name => {
    const files = companionsOf(name, dir, root).map(
      ([file, text]) =>
        `    ${JSON.stringify(file)}:\n      ${JSON.stringify(text)},`,
    );
    return files.length === 0
      ? []
      : [`  ${JSON.stringify(name)}: {`].concat(files, "  },");
  });
  return [
    "/**",
    " * @file The companion files of Ork's built-in workflows, by workflow name, then",
    " *   by path relative to the workflow's folder, as text. Do not edit by hand:",
    " *   `node tools/release/builtin-workflows.ts` and `pnpm build` rewrite it, and",
    " *   a test fails when it is stale.",
    " */",
    "",
    "export const BUILTIN_FILES: Readonly<",
    "  Record<string, Readonly<Record<string, string>>>",
    "> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
};

/** Writes `source` to `file` when it differs. */
const update = (file: string, source: string): void => {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = "";
  }
  if (current !== source) writeFileSync(file, source);
};

if (import.meta.main) {
  update(WORKFLOWS_MODULE, workflowsModule());
  update(BUNDLES_MODULE, bundlesModule());
  process.stdout.write(
    `Bundled the built-in workflows into ${WORKFLOWS_MODULE} and ${BUNDLES_MODULE}\n`,
  );
}
