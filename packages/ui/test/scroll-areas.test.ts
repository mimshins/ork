/**
 * @file Tests that every scroll area in the style sheets keeps its scrolling to
 *   itself: `overscroll-behavior: contain`, so a wheel at its end doesn't
 *   scroll the dock around it, and a `position`, so the absolutely placed text
 *   only a screen reader reads (`visuallyHidden`) is placed inside it rather
 *   than against the dock's own scroll box. Without both, a panel scrolled to
 *   its end carried its whole group, header and all, up the dock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rulesIn, type SheetRule } from "./sheets.ts";
import { sourceFiles, SRC } from "./tokens.ts";

const SCROLLS = /^(?:auto|scroll)$/u;

/** `overflow` or `overflow-y`, the properties that make a vertical scroll. */
const OVERFLOW = /^overflow(?:-y)?$/u;

/** The tokens a sheet sets to `auto` or `scroll`. */
const scrollingTokens = (rules: readonly SheetRule[]): Set<string> =>
  new Set(
    rules.flatMap(rule =>
      rule.declarations
        .filter(([name, value]) => name.startsWith("--") && SCROLLS.test(value))
        .map(([name]) => name),
    ),
  );

/** Whether a value scrolls: `auto`, `scroll`, or a token set to one. */
const scrolls = (value: string, tokens: Set<string>): boolean => {
  const token = /^var\((--[\w-]+)/u.exec(value)?.[1];
  return SCROLLS.test(value) || (token !== undefined && tokens.has(token));
};

/** Each scroll area's rule as `sheet selector`, with what it lacks. */
const scrollAreas = (): { area: string; lacks: string[] }[] =>
  sourceFiles()
    .filter(file => file.endsWith(".module.css"))
    .flatMap(file => {
      const rules = rulesIn(readFileSync(join(SRC, file), "utf8"));
      const tokens = scrollingTokens(rules);
      return rules
        .filter(rule =>
          rule.declarations.some(
            ([name, value]) => OVERFLOW.test(name) && scrolls(value, tokens),
          ),
        )
        .map(rule => {
          const names = new Set(rule.declarations.map(([name]) => name));
          const contained = rule.declarations.some(
            ([name, value]) =>
              name === "overscroll-behavior" && value === "contain",
          );
          return {
            area: `${file} ${rule.selector}`,
            lacks: [
              ...(contained ? [] : ["overscroll-behavior: contain"]),
              ...(names.has("position") ? [] : ["position"]),
            ],
          };
        });
    });

describe("scroll areas", () => {
  it("finds the panels' scroll areas", () => {
    expect(scrollAreas().map(({ area }) => area)).toContain(
      "panels/context.module.css .panel",
    );
  });

  it("each keeps its scrolling, and its hidden text, to itself", () => {
    expect(scrollAreas().filter(({ lacks }) => lacks.length > 0)).toEqual([]);
  });
});
