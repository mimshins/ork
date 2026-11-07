/**
 * @file Tests that the UI's own copy never shows a command as inline code: a
 *   command the user would type or copy is a code block (`CopyCommand`, an
 *   empty state's `cli`, a control's `cli` in its tip), and inline code is for
 *   names (specs/ui/design-components-and-copy.md#copy). It reads every string,
 *   template and `<code>` element in the source and fails on a backticked run
 *   that starts with a program's name and goes on. The engine's and the CLI's
 *   messages aren't in the source, so they still show exactly as written.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { codeParts } from "../src/components/code-text.tsx";
import { textsOf } from "./copy-texts.ts";
import { sourceFiles, SRC } from "./tokens.ts";

/** A run that starts with a program a user types, then says more. */
const COMMAND =
  /^(?:ork|git|pnpm|npm|npx|gh|claude|cd|yarn|bun|volta|aws|brew)\s+\S/u;

/**
 * Runs that name a program as a thing, which copy may mark inline. Keep it
 * short: each is a name in every sentence it's in, never a step to take.
 */
const NAMES = new Set([
  // The server this page talks to: "`ork ui` is back on 0.4.0".
  "ork ui",
  // How a decision was answered: "Answered Merge it with `ork decide`".
  "ork decide",
  // The watcher, as a process: "`ork watch` isn't running".
  "ork watch",
]);

/** The command-shaped inline runs in a source file's copy. */
const inlineCommands = (source: string): string[] =>
  textsOf(source)
    .flatMap(text => codeParts(text))
    .filter(({ code, text }) => code && COMMAND.test(text) && !NAMES.has(text))
    .map(({ text }) => text);

const SOURCES = sourceFiles().filter(file => /\.tsx?$/u.test(file));

describe("commands in the UI's copy", () => {
  it.each(SOURCES)("%s: shows no command as inline code", file => {
    expect(inlineCommands(readFileSync(join(SRC, file), "utf8"))).toEqual([]);
  });

  it("finds one in a string, a template and a code element", () => {
    expect(
      inlineCommands(`
        const a = "Run \`ork init\` first.";
        const b = \`Then \\\`ork run \${workflow}\\\`.\`;
        const C = () => <p>Or <code>gh auth login</code>.</p>;
      `),
    ).toEqual(["ork init", "ork run …", "gh auth login"]);
  });

  it("lets names, comments, regular expressions and plain commands be", () => {
    expect(
      inlineCommands(`
        /** As \`ork feedback show\` gives it. */
        const a = "\`ork ui\` is back, but the \`ork\` it started is older.";
        const b = /(\`+)(.+?)\\1/gu; // \`ork ps\`
        const c = \`ork pause \${runId}\`;
        const D = () => <CopyCommand command="ork logs 4f2a1c" />;
      `),
    ).toEqual([]);
  });
});
