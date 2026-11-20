/**
 * @file Adding allow rules to a project's rules file (RFC-028): the rules are
 *   appended to `permissions.allow`, and only the lines that had to change
 *   differ, so the file's comments and layout stay.
 */

import { isScalar, isSeq, parseDocument } from "yaml";

import { keepingUntouchedLines, styleOf } from "./edit-lines.ts";
import { parseProject } from "./yaml.ts";

/**
 * A project file's text with `rules` appended to `permissions.allow`, skipping
 * one already there; the same text when none is new. Throws when the file
 * doesn't parse, or would no longer be valid project rules.
 */
export const withAllowRules = (
  text: string,
  rules: readonly string[],
): string => {
  const doc = parseDocument(text, { prettyErrors: false });
  const [syntax] = doc.errors;
  if (syntax !== undefined) {
    throw new Error(
      `the file doesn't parse: ${syntax.message.split("\n")[0] ?? syntax.message}`,
    );
  }
  const allow = doc.getIn(["permissions", "allow"], true);
  const listed = new Set(
    isSeq(allow)
      ? allow.items.map(item => (isScalar(item) ? item.value : item))
      : [],
  );
  const adding = [...new Set(rules)].filter(rule => !listed.has(rule));
  if (adding.length === 0) return text;
  const style = styleOf(text);
  const printed = doc.toString(style);
  if (isSeq(allow)) for (const rule of adding) allow.add(doc.createNode(rule));
  else doc.setIn(["permissions", "allow"], adding);
  const next = keepingUntouchedLines(text, printed, doc.toString(style));
  const parsed = parseProject(next);
  if (!parsed.ok) {
    const [first] = parsed.diagnostics;
    throw new Error(
      `the rules would not be valid: ${first?.message ?? "unknown problem"}`,
    );
  }
  return next;
};
