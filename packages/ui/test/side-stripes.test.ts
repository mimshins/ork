/**
 * @file Tests that no style sheet marks anything with a side stripe: a colored
 *   edge down one side of a card, a row or a message. A note is a line with its
 *   icon beside it, attention is a tint or a word, a problem is the failed
 *   glyph with its words (the design system's language). The one inside edge
 *   allowed is the neutral hairline that shows nesting, as the Builder's groups
 *   do.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, SRC, withoutComments } from "./tokens.ts";

/** A border on one side, as a property or a token named for one. */
const SIDE =
  /(?:^|-)border-(?:left|right|inline-start|inline-end)(?:-(?:width|style|color))?$/u;

/** A value that draws no edge, or one drawn only in forced colors' Canvas. */
const NO_EDGE = /^(?:0|none|initial|transparent|Canvas)$/u;

/** The neutral hairline that shows nesting. */
const GUIDE = "var(--hairline) solid var(--color-border)";

/** A read of a token that is itself a side's, so it's checked where it's set. */
const SIDE_READ = /^var\((--[\w-]+)(?:, revert)?\)$/u;

/** An inset shadow pushed in from a side, which draws the same stripe. */
const SIDE_SHADOW = /\binset (?!0 )\S+/u;

const tidy = (value: string): string =>
  value
    .replaceAll(/\s+/gu, " ")
    .replaceAll("( ", "(")
    .replaceAll(" )", ")")
    .trim();

const isSideRead = (value: string): boolean =>
  SIDE.test(SIDE_READ.exec(value)?.[1] ?? "");

/** Every declaration in a sheet that draws an edge down one side. */
const stripesIn = (css: string): string[] =>
  [...withoutComments(css).matchAll(/([\w-]+)\s*:\s*([^;{}]+);/gu)]
    .map(([, name = "", value = ""]) => [name, tidy(value)] as const)
    .filter(
      ([name, value]) =>
        (SIDE.test(name) &&
          !NO_EDGE.test(value) &&
          value !== GUIDE &&
          !isSideRead(value)) ||
        (/(?:^|-)shadow$/u.test(name) && SIDE_SHADOW.test(value)),
    )
    .map(([name, value]) => `${name}: ${value}`);

const STYLE_SHEETS = sourceFiles().filter(file => file.endsWith(".css"));

describe("side stripes", () => {
  it.each(STYLE_SHEETS)("%s: marks nothing with a side stripe", file => {
    expect(stripesIn(readFileSync(join(SRC, file), "utf8"))).toEqual([]);
  });

  it("finds a stripe, so the check above can fail", () => {
    expect(
      stripesIn(`
        .a { --a-border-inline-start-color: var(--color-action-edge); }
        .b { border-left: var(--focus-width) solid red; }
        .c { --c-shadow: inset var(--focus-width) 0 0 var(--amber-500); }
        .d { border-inline-start: var(--d-edge); }
      `),
    ).toEqual([
      "--a-border-inline-start-color: var(--color-action-edge)",
      "border-left: var(--focus-width) solid red",
      "--c-shadow: inset var(--focus-width) 0 0 var(--amber-500)",
      "border-inline-start: var(--d-edge)",
    ]);
  });

  it("lets a hairline show nesting, and a tab its underline", () => {
    expect(
      stripesIn(`
        .a { --a-border-inline-start: var(--hairline) solid var(--color-border); }
        .a { border-inline-start: var(--a-border-inline-start, revert); }
        .t { --t-shadow: inset 0 calc(var(--focus-width) * -1) 0 var(--x); }
      `),
    ).toEqual([]);
  });
});
