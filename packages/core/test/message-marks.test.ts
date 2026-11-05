/**
 * @file What the engine says marks a value with backticks, which the browser
 *   view shows as inline code. A value in double quotes wouldn't show as one.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

/** The page served before the UI is built is HTML, whose quotes are its own. */
const NOT_MESSAGES = new Set(["server/src/placeholder.ts"]);

const sources = ["core", "nodes", "server", "schema"].flatMap(name =>
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
    .filter(line => line.includes('"${'));

describe("what the engine says", () => {
  it.each(sources)("%s marks values with backticks", file => {
    expect(quotedIn(file)).toEqual([]);
  });
});
