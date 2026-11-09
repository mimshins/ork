/**
 * @file Checks on `output.gather`: each field it names must be one the node
 *   declares as a list, since only a list's entries can be added round after
 *   round, and a node with `forEach` reports its gathered items instead of its
 *   own fields, so it has none to keep.
 */

import type { Diagnostic, Node } from "@krapht/ork-schema";

import { error } from "./diagnostics.ts";
import { listShape } from "./says.ts";
import { declaredOutputOf, forEachOf, gatheredFieldsOf } from "./types.ts";

/** Whether a declared field is a list: `{ type: array }` or `{ list: … }`. */
const isList = (rule: unknown): boolean =>
  listShape(rule) !== undefined ||
  (typeof rule === "object" &&
    rule !== null &&
    "type" in rule &&
    rule.type === "array");

export const gatherProblems = (id: string, node: Node): Diagnostic[] => {
  const fields = gatheredFieldsOf(node);
  if (fields.length === 0) return [];
  const path = ["nodes", id, "output", "gather"];
  if (forEachOf(node) !== undefined) {
    return [
      error(
        "output.gather",
        `\`${id}\` runs once per item and reports its items' results, so it has no fields of its own to keep across rounds`,
        path,
      ),
    ];
  }
  const declared = declaredOutputOf(node) ?? {};
  return fields.flatMap((field, index) => {
    const rule = declared[field];
    if (rule === undefined) {
      return [
        error(
          "output.gather",
          `\`${field}\` isn't in \`${id}\`'s \`output.schema\`; declare it as a list to keep it across rounds`,
          [...path, index],
        ),
      ];
    }
    return isList(rule)
      ? []
      : [
          error(
            "output.gather",
            `\`${field}\` isn't declared as a list (\`{ type: array }\` or \`{ list: … }\`), so its rounds can't be added together`,
            [...path, index],
          ),
        ];
  });
};
