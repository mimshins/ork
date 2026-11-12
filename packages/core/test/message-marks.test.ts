/**
 * @file What the engine says marks a value with backticks, which the browser
 *   view shows as inline code. A value in double quotes wouldn't show as one.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

/**
 * A value in either kind of quote, or written out as JSON after a word. Also
 * caught: a condition's own literal, which is meant, so its two places are
 * named.
 */
const QUOTED = /["']\$\{|[a-z] \$\{JSON\.stringify\(/iu;

/**
 * The page served before the UI is built is HTML, whose quotes are its own;
 * `ork --help`'s footer quotes a command the way kubectl's does, on a terminal
 * only. `issues-workflow.ts` is the `issues` example's YAML, shell quotes and
 * all.
 */
const NOT_MESSAGES = new Set([
  "server/src/placeholder.ts",
  "server/src/condition-text.ts",
  "schema/src/edit-values.ts",
  "cli/src/help-root.ts",
  "cli/src/project/issues-workflow.ts",
]);

const PACKAGES = [
  "integrations",
  "schema",
  "core",
  "runtime",
  "nodes",
  "server",
  "cli",
];

const sources = PACKAGES.flatMap(name =>
  readdirSync(path.join(root, name, "src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter(file => file.endsWith(".ts"))
    .map(file => path.join(name, "src", file))
    .filter(file => !NOT_MESSAGES.has(file)),
);

const quotedIn = (file: string): string[] =>
  readFileSync(path.join(root, file), "utf8")
    .split("\n")
    .filter(line => QUOTED.test(line));

describe("what the engine says", () => {
  it.each(sources)("%s marks values with backticks", file => {
    expect(quotedIn(file)).toEqual([]);
  });
});
