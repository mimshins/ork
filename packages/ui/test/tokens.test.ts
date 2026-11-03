/**
 * @file Tests for the design system's tokens: every pairing in test/pairings.ts
 *   meets WCAG 2.2 AA in each look (dark and light, standard and more
 *   contrast); no color token escapes the pairings; the layers stay apart
 *   (colors written out only in the primitives, primitives named only by the
 *   semantic layer); both themes define the same tokens; and text sizes come
 *   from the type scale, none below 11 px; and a popup opens above the dialog
 *   it came from.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXEMPT, PAIRINGS } from "./pairings.ts";
import {
  colorOf,
  contrast,
  isColor,
  type Look,
  lookName,
  LOOKS,
  readToken,
  rulesOf,
  sourceFiles,
  SRC,
  TOKEN_FILES,
  tokensFor,
  valueOf,
  withoutComments,
} from "./tokens.ts";

const DARK_LOOK: Look = { theme: "dark", contrast: "standard" };

const ratio = (value: number): string => `${value.toFixed(2)}:1`;

/** The pairings that miss their minimum in a look, as readable lines. */
const failingPairs = (look: Look): string[] => {
  const tokens = tokensFor(look);
  return PAIRINGS.flatMap(({ fg, bg, min }) =>
    fg.flatMap(front =>
      bg.map(back => ({
        line: `${front} on ${back}`,
        value: contrast(colorOf(tokens, front), colorOf(tokens, back)),
        min,
      })),
    ),
  )
    .filter(({ value, min }) => value < min)
    .map(({ line, value, min }) => `${line}: ${ratio(value)} < ${String(min)}`);
};

const PRIMITIVES = new Set(
  rulesOf(readToken("primitives.css")).flatMap(rule =>
    rule.declarations.map(([name]) => name),
  ),
);

const PAIRED = new Set(PAIRINGS.flatMap(({ fg, bg }) => fg.concat(bg)));

/** Color tokens, past the primitives, that no pairing or exemption covers. */
const unchecked = (look: Look): string[] => {
  const tokens = tokensFor(look);
  return [...tokens.keys()].filter(
    name =>
      !PRIMITIVES.has(name) &&
      isColor(valueOf(tokens, name)) &&
      !PAIRED.has(name) &&
      !(name in EXEMPT),
  );
};

const declared = (selector: string): string[] =>
  rulesOf(readToken("themes.css"))
    .filter(rule => rule.selector === selector)
    .flatMap(rule => rule.declarations.map(([name]) => name))
    .toSorted();

const DARK = ':root, [data-theme="dark"]';
const LIGHT = '[data-theme="light"]';

const STYLES = sourceFiles().filter(file => /\.(?:css|tsx?)$/u.test(file));
const read = (file: string): string =>
  withoutComments(readFileSync(join(SRC, file), "utf8"));

const RAW_COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|:\s*(?:white|black|red|green|blue|yellow|orange|gray|grey|silver)\s*[;}]/giu;

/** Files outside the primitives that write a color out, with what they wrote. */
const rawColors = (): string[] =>
  STYLES.filter(file => file !== "design/tokens/primitives.css").flatMap(file =>
    [...read(file).matchAll(RAW_COLOR)].map(([hit]) => `${file}: ${hit}`),
  );

const SEMANTIC = new Set([
  "design/tokens/primitives.css",
  "design/tokens/themes.css",
  "design/tokens/scale.css",
]);

/** Uses of a primitive outside the semantic layer (themes.css, scale.css). */
const primitiveUses = (): string[] =>
  STYLES.filter(file => !SEMANTIC.has(file)).flatMap(file =>
    [...read(file).matchAll(/var\((--[\w-]+)\)/gu)]
      .map(([, name = ""]) => name)
      .filter(name => PRIMITIVES.has(name))
      .map(name => `${file}: ${name}`),
  );

/** `font-size` values that do not come from the type scale. */
const looseFontSizes = (): string[] =>
  STYLES.flatMap(file =>
    [...read(file).matchAll(/font-size\s*:\s*([^;]+);/gu)]
      .map(([, value = ""]) => value.trim())
      .filter(value => !/^var\(--(?:text|icon-size)[\w-]*\)$/u.test(value))
      .map(value => `${file}: ${value}`),
  );

const COMPONENT_STYLES = STYLES.filter(
  file => file.startsWith("components/") && file.endsWith(".css"),
);
const RAW_MEASURE =
  /(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s)\b|z-index\s*:\s*\d/gu;

/** Sizes, durations and layers a component style writes out, not as tokens. */
const rawMeasures = (): string[] =>
  COMPONENT_STYLES.flatMap(file =>
    [...read(file).matchAll(RAW_MEASURE)].map(([hit]) => `${file}: ${hit}`),
  );

/** The type scale's sizes in px, at the browser's default 16 px rem. */
const textSizes = (): number[] => {
  const tokens = tokensFor(DARK_LOOK);
  return [...tokens.keys()]
    .filter(name => name.startsWith("--text-"))
    .map(name => Number(valueOf(tokens, name).replace(/rem$/u, "")) * 16);
};

describe("contrast", () => {
  it.each(LOOKS.map(look => [lookName(look), look] as const))(
    "meets WCAG 2.2 AA for every pairing (%s)",
    (_name, look) => {
      expect(failingPairs(look)).toEqual([]);
    },
  );

  it.each(LOOKS.map(look => [lookName(look), look] as const))(
    "checks every color token (%s)",
    (_name, look) => {
      expect(unchecked(look)).toEqual([]);
    },
  );

  it("exempts only tokens that exist", () => {
    const tokens = tokensFor(DARK_LOOK);
    expect(Object.keys(EXEMPT).filter(name => !tokens.has(name))).toEqual([]);
  });

  it("gives text on the logo's fills the screen color, at about 10.7:1", () => {
    expect(ratio(contrast("#0a0d0b", "#ffb000"))).toBe("10.66:1");
    expect(ratio(contrast("#0a0d0b", "#3dff8a"))).toBe("14.76:1");
  });
});

describe("the token layers", () => {
  it("keep their files flat: no at-rules and no nesting", () => {
    expect(
      TOKEN_FILES.filter(file =>
        withoutComments(readToken(file)).includes("@"),
      ),
    ).toEqual([]);
  });

  it("define the same tokens in both themes", () => {
    expect(declared(LIGHT)).toEqual(declared(DARK));
  });

  it("raise contrast only on tokens their theme defines", () => {
    const dark = new Set(declared(DARK));
    const overrides = [
      ...declared('[data-theme="dark"][data-contrast="more"]'),
      ...declared('[data-theme="light"][data-contrast="more"]'),
    ];
    expect(overrides.filter(name => !dark.has(name))).toEqual([]);
  });

  it("write a color out only in the primitives", () => {
    expect(rawColors()).toEqual([]);
  });

  it("name a primitive only in the semantic layer", () => {
    expect(primitiveUses()).toEqual([]);
  });
});

describe("component styles", () => {
  it("exist, for the check below to mean something", () => {
    expect(COMPONENT_STYLES.length).toBeGreaterThan(0);
  });

  it("write no size, duration or layer out, only tokens", () => {
    expect(rawMeasures()).toEqual([]);
  });
});

describe("type", () => {
  it("takes every font size from the type scale", () => {
    expect(looseFontSizes()).toEqual([]);
  });

  it("has no size below 11 px", () => {
    expect(textSizes().filter(px => px < 11)).toEqual([]);
    expect(textSizes()).toHaveLength(5);
  });
});

describe("the stacking layers", () => {
  // A dialog's combobox lists open in a portal: jsdom cannot see them hidden.
  it("puts a popup above the dialog it came from", () => {
    const scale = readFileSync(join(SRC, "design/tokens/scale.css"), "utf8");
    const layerOf = (name: string): number =>
      Number(new RegExp(`--layer-${name}: (\\d+)`, "u").exec(scale)?.[1]);
    expect(layerOf("popup")).toBeGreaterThan(layerOf("dialog"));
    expect(layerOf("toast")).toBeGreaterThan(layerOf("popup"));
  });
});
