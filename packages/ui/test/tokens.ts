/**
 * @file The token tests' reader: parses the design system's flat token files,
 *   applies them the way the cascade would for each look (theme and contrast
 *   set on the root), resolves a token through its `var()` chain to a hex
 *   color, and measures WCAG 2.2 contrast between two colors.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const SRC = join(import.meta.dirname, "../src");
export const TOKENS = join(SRC, "design/tokens");

/** The token files in cascade order, as design.css imports them. */
export const TOKEN_FILES = [
  "primitives.css",
  "themes.css",
  "scale.css",
  "components.css",
];

export type Look = { theme: "dark" | "light"; contrast: "standard" | "more" };

export const LOOKS: Look[] = [
  { theme: "dark", contrast: "standard" },
  { theme: "dark", contrast: "more" },
  { theme: "light", contrast: "standard" },
  { theme: "light", contrast: "more" },
];

export const lookName = (look: Look): string =>
  look.contrast === "more" ? `${look.theme}, more contrast` : look.theme;

type Rule = { selector: string; declarations: [string, string][] };

const COMMENT = /\/\*[\s\S]*?\*\//gu;
const RULE = /([^{}]+)\{([^{}]*)\}/gu;
const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/gu;
const ATTRIBUTE = /\[([\w-]+)="([\w-]+)"\]/gu;

export const withoutComments = (css: string): string =>
  css.replaceAll(COMMENT, "");

export const rulesOf = (css: string): Rule[] =>
  [...withoutComments(css).matchAll(RULE)].map(([, selector = "", body]) => ({
    selector: selector.trim().replaceAll(/\s+/gu, " "),
    declarations: [...(body ?? "").matchAll(DECLARATION)].map(
      ([, name = "", value = ""]) => [
        name,
        value.trim().replaceAll(/\s+/gu, " "),
      ],
    ),
  }));

export const readToken = (file: string): string =>
  readFileSync(join(TOKENS, file), "utf8");

/** Whether one comma-separated part of a selector matches the root. */
const partMatches = (part: string, attributes: Record<string, string>) => {
  const rest = part.replace(":root", "").replaceAll(ATTRIBUTE, "").trim();
  if (rest !== "") throw new Error(`Unsupported token selector: ${part}`);
  return [...part.matchAll(ATTRIBUTE)].every(
    ([, name = "", value]) => attributes[name] === value,
  );
};

const specificity = (part: string): number =>
  (part.includes(":root") ? 1 : 0) + [...part.matchAll(ATTRIBUTE)].length;

/** Every custom property the root has in a look, as the cascade sets it. */
export const tokensFor = (look: Look): Map<string, string> => {
  const attributes = {
    "data-theme": look.theme,
    "data-contrast": look.contrast,
  };
  const applied: {
    weight: number;
    order: number;
    name: string;
    value: string;
  }[] = [];
  let order = 0;
  for (const file of TOKEN_FILES) {
    for (const rule of rulesOf(readToken(file))) {
      const weights = rule.selector
        .split(",")
        .map(part => part.trim())
        .filter(part => partMatches(part, attributes))
        .map(part => specificity(part));
      const weight = Math.max(-1, ...weights);
      for (const [name, value] of rule.declarations) {
        order += 1;
        if (weight >= 0) applied.push({ weight, order, name, value });
      }
    }
  }
  const ordered = applied.toSorted(
    (a, b) => a.weight - b.weight || a.order - b.order,
  );
  return new Map(ordered.map(({ name, value }) => [name, value]));
};

const VAR = /^var\((--[\w-]+)\)$/u;
const HEX = /^#[0-9a-f]{6}$/u;

/** A token's final value, following its `var()` chain. */
export const valueOf = (tokens: Map<string, string>, name: string): string => {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    const value = tokens.get(current);
    if (value === undefined) throw new Error(`${current} is not defined`);
    const next = VAR.exec(value)?.[1];
    if (next === undefined) return value;
    if (seen.has(next)) throw new Error(`${name} refers to itself`);
    seen.add(next);
    current = next;
  }
};

export const isColor = (value: string): boolean => HEX.test(value);

/** A token's color; it fails when the token is not a plain hex color. */
export const colorOf = (tokens: Map<string, string>, name: string): string => {
  const value = valueOf(tokens, name);
  if (!isColor(value)) throw new Error(`${name} is ${value}, not a color`);
  return value;
};

const channel = (byte: number): number => {
  const c = byte / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

/** WCAG 2.2 contrast ratio between two colors, from 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Every file under `src`, as paths relative to it. */
export const sourceFiles = (dir = SRC): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [relative(SRC, path)];
  });
