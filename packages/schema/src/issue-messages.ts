/**
 * @file What Ork says when a node's `type`, a `forEach`, or a `list` rule in a
 *   tool's declared output is written wrong: Zod's own words for a union
 *   ("Invalid input") name no key, so these say what to write instead.
 */

import type { z } from "zod";

import { markValue } from "./marks.ts";
import { NodeSchema } from "./nodes.ts";
import { RETIRED_NODE_TYPES } from "./retired-types.ts";
import { LIST_RULE_HINT } from "./settings.ts";

const NODE_TYPES = NodeSchema.options.map(o => o.shape.type.value);

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The text for an issue at or under a `forEach`, else `null`. */
export const forEachMessage = (
  issue: z.core.$ZodIssue,
  path: readonly (string | number)[],
  value: unknown,
): string | null => {
  const key = path.at(-1);
  if (issue.code === "too_small" && path.at(-2) === "forEach") {
    if (key === "items") {
      return "`forEach.items` is empty: list at least one item, or use `from`";
    }
    if (key === "maxItems") {
      return "`forEach.maxItems` must be at least 1: the most items to run before Ork asks";
    }
  }
  if (issue.code !== "invalid_union" || key !== "forEach") return null;
  if (!isMap(value)) {
    return "`forEach` takes a map: `items: [...]` for a list written here, or `from:` with `maxItems:` for an earlier node's";
  }
  if ("items" in value && "from" in value) {
    return "`forEach` takes `items` or `from`, not both";
  }
  if ("from" in value) {
    return "`forEach` with `from` needs `maxItems`: the most items to run before Ork asks";
  }
  if (!("items" in value)) {
    return "`forEach` needs `items` or `from`: a list written here, or an earlier node's";
  }
  return null;
};

/** The text for a `list` rule that is not a map of fields, else `null`. */
export const listRuleMessage = (
  issue: z.core.$ZodIssue,
  value: unknown,
): string | null =>
  issue.code === "invalid_union" && isMap(value) && "list" in value
    ? LIST_RULE_HINT
    : null;

/** The text for a node whose `type` is missing or unknown, else `null`. */
export const nodeTypeMessage = (
  issue: z.core.$ZodIssue,
  value: unknown,
): string | null => {
  if (issue.code !== "invalid_union" || issue.discriminator !== "type") {
    return null;
  }
  const renamed =
    typeof value === "string" && Object.hasOwn(RETIRED_NODE_TYPES, value)
      ? RETIRED_NODE_TYPES[value]
      : undefined;
  if (renamed !== undefined) {
    return `${markValue(String(value))} was renamed to ${markValue(renamed)}; run \`ork migrate\``;
  }
  const types = NODE_TYPES.map(type => markValue(type)).join(", ");
  return value === undefined
    ? `node needs a \`type\`: one of ${types}`
    : `unknown node type ${markValue(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))}: expected one of ${types}`;
};
