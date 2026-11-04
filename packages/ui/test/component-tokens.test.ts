/**
 * @file Tests for the token rule (ADR-054): a component declares its tokens on
 *   its base rule and reads them there, and a rule for a state, a variant or a
 *   forced-colors mode only sets tokens. So changing how the UI looks means
 *   changing a token's value, never finding every rule that sets a property.
 *   Each state's text is also checked against its background, in every look.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  baseClasses,
  isOverride,
  prefixesOf,
  readSheet,
  SHEETS,
  type SheetRule,
  statesOf,
} from "./sheets.ts";
import {
  colorOf,
  contrast,
  isColor,
  sourceFiles,
  SRC,
  withoutComments,
  LOOKS,
  lookName,
  type Look,
  tokensFor,
  valueOf,
} from "./tokens.ts";

/** What says how a thing is laid out, not how it looks, so it may be written. */
const STRUCTURAL = new Set(
  `composes display position flex-direction flex-wrap flex flex-flow flex-grow
  flex-shrink flex-basis align-items align-self align-content justify-content
  justify-items justify-self place-items place-content overflow overflow-x
  overflow-y overflow-wrap word-break white-space text-overflow text-align
  vertical-align box-sizing cursor pointer-events user-select list-style
  appearance resize object-fit container-type container-name isolation
  scrollbar-width scrollbar-color grid-column grid-row grid-area grid-auto-flow
  order content text-decoration font-variant-numeric text-transform contain
  will-change forced-color-adjust visibility text-wrap hyphens touch-action
  clip-path overscroll-behavior scroll-behavior -webkit-font-smoothing
  font-feature-settings writing-mode direction table-layout border-collapse
  border-spacing caption-side field-sizing transform-origin grid-auto-rows
  grid-auto-columns interpolate-size`.split(/\s+/u),
);

/** A value that takes a default away, and has nothing to say about the look. */
const RESET =
  /^(?:0|none|auto|100%|inherit|unset|normal|m(?:in|ax)-content|fit-content|0 0 auto|1 1 auto)$/u;

const READ = /^var\(\s*--[\w-]+(?:,\s*revert)?\s*\)$/u;

const isToken = (name: string): boolean => name.startsWith("--");

const bare = (rule: SheetRule): string[] =>
  rule.declarations
    .filter(([name]) => !isToken(name))
    .map(([name, value]) => `${rule.selector} { ${name}: ${value} }`);

/** Properties set by a rule that should only set tokens. */
const overridesWithProperties = (file: string): string[] => {
  const rules = readSheet(file);
  const bases = baseClasses(rules);
  return rules
    .filter(rule => isOverride(rule, bases))
    .flatMap(rule => bare(rule));
};

const baseRules = (file: string): SheetRule[] => {
  const rules = readSheet(file);
  const bases = baseClasses(rules);
  return rules.filter(rule => !isOverride(rule, bases));
};

/** How a thing looks, written in its base rule rather than read from a token. */
const unreadProperties = (file: string): string[] =>
  baseRules(file).flatMap(({ selector, declarations }) =>
    declarations
      .filter(
        ([name, value]) =>
          !isToken(name) &&
          !STRUCTURAL.has(name) &&
          !RESET.test(value) &&
          !READ.test(value),
      )
      .map(([name, value]) => `${selector} { ${name}: ${value} }`),
  );

/** Tokens a base rule declares that aren't named for its component. */
const strangers = (file: string): string[] => {
  const prefixes = [...prefixesOf(file), "--dv-"];
  return baseRules(file).flatMap(({ declarations }) =>
    declarations
      .map(([name]) => name)
      .filter(
        name =>
          isToken(name) && !prefixes.some(prefix => name.startsWith(prefix)),
      ),
  );
};

/** Tokens of its own a sheet reads, with no base rule declaring them. */
const undeclaredReads = (file: string): string[] => {
  const rules = readSheet(file);
  const declared = new Set(
    baseRules(file).flatMap(({ declarations }) =>
      declarations.map(([name]) => name),
    ),
  );
  const own = prefixesOf(file);
  return rules
    .flatMap(({ declarations }) => declarations)
    .flatMap(([, value]) =>
      [...value.matchAll(/var\((--[\w-]+)/gu)].map(([, name = ""]) => name),
    )
    .filter(
      name =>
        own.some(prefix => name.startsWith(prefix)) && !declared.has(name),
    );
};

/** What should come from the scale: space, corners, weight and time. */
const SCALED =
  /-(?:padding|margin|gap|radius|leading|tracking|transition)[\w-]*$/u;
const RAW = /(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s)\b/u;

/** Spacing, corners, weights and timing written out instead of named. */
const rawScaleValues = (file: string): string[] =>
  readSheet(file)
    .flatMap(({ declarations }) => declarations)
    .filter(
      ([name, value]) =>
        isToken(name) &&
        ((SCALED.test(name) && RAW.test(value)) ||
          (name.endsWith("-weight") && /^\d+$/u.test(value))),
    )
    .map(([name, value]) => `${name}: ${value}`);

const AA_TEXT = 4.5;

/** A token's color in this state, when it comes to one. */
const colorIn = (
  tokens: Map<string, string>,
  name: string,
): string | undefined => {
  if (!tokens.has(name)) return undefined;
  const value = valueOf(tokens, name);
  return isColor(value) ? colorOf(tokens, name) : undefined;
};

/** Disabled text has no contrast to keep (WCAG 1.4.3). */
const isDisabledText = (value: string | undefined): boolean =>
  value === "var(--color-text-disabled)";

/** Each state's text that misses AA on that state's own background. */
const faintStates = (file: string, look: Look): string[] => {
  const root = tokensFor(look);
  return statesOf(readSheet(file)).flatMap(({ selector, tokens }) => {
    const all = new Map([...root, ...tokens]);
    return [...tokens.keys()]
      .filter(name => name.endsWith("-text"))
      .flatMap(name => {
        const text = colorIn(all, name);
        const back = colorIn(all, `${name.slice(0, -"text".length)}bg`);
        if (text === undefined || back === undefined) return [];
        if (isDisabledText(tokens.get(name))) return [];
        const ratio = contrast(text, back);
        return ratio < AA_TEXT
          ? [`${selector}: ${name} is ${ratio.toFixed(2)}:1 on its background`]
          : [];
      });
  });
};

const STYLE_SHEETS = sourceFiles().filter(file => file.endsWith(".css"));

/**
 * Toolbars that set their own padding, so one panel's would differ from the
 * next.
 */
const looseToolbars = (): string[] =>
  STYLE_SHEETS.flatMap(file =>
    [
      ...textOf(file).matchAll(
        /(--[\w-]*(?:tools|monitor-header)-padding)\s*:\s*([^;]+);/gu,
      ),
    ]
      .filter(([, , value = ""]) => value.trim() !== "var(--inset-tools)")
      .map(([, name = ""]) => `${file}: ${name}`),
  );

const textOf = (file: string): string =>
  withoutComments(readFileSync(join(SRC, file), "utf8"));

/** Lengths in px, which wouldn't follow the browser's text size. */
const pixels = (file: string): string[] =>
  textOf(file).match(/(?<![\w-])\d*\.?\d+px\b/gu) ?? [];

const UNITLESS = /^(?:\d*\.?\d+|var\(\s*--[\w-]*leading[\w-]*\s*\))$/u;

/** Line heights with a unit, which wouldn't follow the text they're on. */
const fixedLineHeights = (file: string): string[] =>
  [...textOf(file).matchAll(/(?:line-height|-leading[\w-]*)\s*:\s*([^;]+);/gu)]
    .map(([, value = ""]) => value.trim())
    .filter(value => !UNITLESS.test(value));

describe("every style sheet", () => {
  it("has style sheets to check", () => {
    expect(STYLE_SHEETS.length).toBeGreaterThan(20);
  });

  it.each(STYLE_SHEETS)("%s: sizes are in rem, never px", file => {
    expect(pixels(file)).toEqual([]);
  });

  it.each(STYLE_SHEETS)("%s: line heights have no unit", file => {
    expect(fixedLineHeights(file)).toEqual([]);
  });
});

describe("the token rule", () => {
  it("has sheets to check", () => {
    expect(SHEETS.length).toBeGreaterThan(20);
  });

  it.each(SHEETS)("%s: a state only sets tokens", file => {
    expect(overridesWithProperties(file)).toEqual([]);
  });

  it.each(SHEETS)("%s: how a thing looks is read from a token", file => {
    expect(unreadProperties(file)).toEqual([]);
  });

  it.each(SHEETS)("%s: declares tokens under its own name", file => {
    expect(strangers(file)).toEqual([]);
  });

  it.each(SHEETS)("%s: reads only tokens it declares", file => {
    expect(undeclaredReads(file)).toEqual([]);
  });

  it.each(SHEETS)("%s: takes space, corners and time from the scale", file => {
    expect(rawScaleValues(file)).toEqual([]);
  });
});

describe("a component's states", () => {
  describe.each(LOOKS.map(look => [lookName(look), look] as const))(
    "%s",
    (_name, look) => {
      it.each(SHEETS)("%s: text meets AA on its background", file => {
        expect(faintStates(file, look)).toEqual([]);
      });
    },
  );

  it("gives every panel's toolbar the same inset", () => {
    expect(looseToolbars()).toEqual([]);
  });

  it("finds a state's pair, so the check above can fail", () => {
    const button = statesOf(readSheet("components/button.module.css"));
    const primary = button.find(({ selector }) =>
      selector.includes('[data-variant="primary"]'),
    );
    expect(primary?.tokens.get("--button-bg")).toBe("var(--color-action)");
    expect(primary?.tokens.get("--button-text")).toBe(
      "var(--color-text-on-action)",
    );
  });
});
