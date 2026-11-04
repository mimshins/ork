/**
 * @file The component style sheets, read for the token rule's tests: each
 *   sheet's rules with their at-rule, which of them are a component's base rule
 *   and which only restate its tokens for a state, and the tokens a variant
 *   ends up with once the rules that apply to it have been laid over each
 *   other.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { sourceFiles, SRC, withoutComments } from "./tokens.ts";

export type SheetRule = {
  selector: string;
  /** The at-rule it's inside, if any: `media (forced-colors: active)`. */
  within?: string;
  declarations: [string, string][];
};

const DECLARATION = /([-\w]+)\s*:\s*([^;]+)(?:;|$)/gu;

/** A sheet's rules, each with the at-rule around it; keyframes are left out. */
export const rulesIn = (css: string): SheetRule[] => {
  const text = withoutComments(css);
  const rules: SheetRule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "{") {
      const head = text.slice(start, at).trim().replaceAll(/\s+/gu, " ");
      const end = head.startsWith("@") ? -1 : text.indexOf("}", at);
      if (end === -1) {
        stack.push(head.slice(1));
        start = at + 1;
      } else {
        const body = text.slice(at + 1, end);
        const within = stack.at(-1);
        if (within?.startsWith("keyframes") !== true) {
          rules.push({
            selector: head,
            ...(within === undefined ? {} : { within }),
            declarations: [...body.matchAll(DECLARATION)].map(
              ([, name = "", value = ""]) => [
                name,
                value.trim().replaceAll(/\s+/gu, " "),
              ],
            ),
          });
        }
        at = end;
        start = end + 1;
      }
    } else if (char === "}") {
      stack.pop();
      start = at + 1;
    }
  }
  return rules;
};

export const SHEETS = sourceFiles().filter(file =>
  file.endsWith(".module.css"),
);

export const readSheet = (file: string): SheetRule[] =>
  rulesIn(readFileSync(join(SRC, file), "utf8"));

/** The prefixes a sheet's own tokens carry. */
export const prefixesOf = (file: string): string[] => {
  const name = basename(file, ".module.css");
  return name === "bits" ? ["--key-", "--keys-", "--empty-"] : [`--${name}-`];
};

const WRAPPER = /:(?:is|where|global)\(/gu;

/** Whether a selector has a state in it: a pseudo-class or an attribute. */
export const hasState = (selector: string): boolean => {
  const plain = selector.replaceAll(WRAPPER, "(");
  return plain.includes("[") || /(?<!:):[a-z]/u.test(plain);
};

/** The class each comma-separated part of a selector ends on, if any. */
const lastClasses = (selector: string): string[] =>
  selector.split(",").flatMap(part => {
    const last =
      part
        .trim()
        .split(/[\s>+~]+/u)
        .at(-1) ?? "";
    return [...last.matchAll(/\.([\w-]+)/gu)].map(([, name = ""]) => name);
  });

/** The classes a sheet has a rule of their own for, with no state in it. */
export const baseClasses = (rules: readonly SheetRule[]): Set<string> =>
  new Set(
    rules
      .filter(
        ({ selector, within }) =>
          within === undefined &&
          selector
            .split(",")
            .every(part => /^\.[\w-]+(?:::[\w-]+)?$/u.test(part.trim())),
      )
      .flatMap(({ selector }) => lastClasses(selector)),
  );

/**
 * Whether a rule may only set tokens: it's for a state, it's inside an at-rule,
 * or it reaches into a component that has a base rule of its own.
 */
export const isOverride = (
  rule: SheetRule,
  bases: ReadonlySet<string>,
): boolean =>
  rule.within !== undefined ||
  hasState(rule.selector) ||
  (/[\s>+~]/u.test(rule.selector.replaceAll(/,\s*/gu, ",")) &&
    lastClasses(rule.selector).some(name => bases.has(name)));

/** The attributes and pseudo-classes a selector requires, as a set. */
const conditionsOf = (selector: string): Set<string> =>
  new Set(selector.match(/\[[^\]]+\]|(?<!:):[\w-]+(?:\([^)]*\))?/gu) ?? []);

const within = (inner: Set<string>, outer: Set<string>): boolean =>
  [...inner].every(item => outer.has(item));

/**
 * Each state a sheet's rules describe, as the tokens an element in it has: the
 * base rules, then every rule whose conditions that state also meets, in source
 * order, as the cascade would lay them.
 */
export const statesOf = (
  rules: readonly SheetRule[],
): { selector: string; tokens: Map<string, string> }[] => {
  const plain = rules.filter(rule => rule.within === undefined);
  return plain.map(({ selector }) => {
    const here = conditionsOf(selector);
    const tokens = new Map<string, string>();
    for (const rule of plain) {
      if (within(conditionsOf(rule.selector), here)) {
        for (const [name, value] of rule.declarations) {
          if (name.startsWith("--")) tokens.set(name, value);
        }
      }
    }
    return { selector, tokens };
  });
};
