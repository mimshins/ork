/**
 * @file A fanned node's `model` and `effort` from its item (`{{item.model}}`):
 *   the compiler's checks (only on a `forEach` node, reading only `item`, and
 *   every written item's value), and the rendering each item's session plan
 *   uses, which checks an item from `from:` when it runs.
 */

import {
  type Diagnostic,
  EFFORTS,
  type Effort,
  isClaudeNode,
  type Workflow,
} from "@krapht/ork-schema";

import {
  parseTemplate,
  renderTemplate,
  type Scope,
  type TemplatePart,
} from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { error } from "./diagnostics.ts";
import { checkItemRead, itemFieldsOf } from "./for-each.ts";
import { describePath } from "./ref-paths.ts";
import { nodeSays } from "./says.ts";
import { type CompiledEdge, forEachOf } from "./types.ts";

export type ItemSettingField = "model" | "effort";

const FIELDS: readonly ItemSettingField[] = ["model", "effort"];

/**
 * The setting an item gives: a value, `undefined` (empty: the default), or what
 * is wrong.
 */
export type ItemSetting<V> =
  | { ok: true; value: V | undefined }
  | { ok: false; error: string };

/**
 * The parts of a template that reads something, or `null` for a plain value (or
 * one that does not parse, which the compiler reports).
 */
const templateOf = (text: string): TemplatePart[] | null => {
  const parsed = parseTemplate(text);
  if (!parsed.ok) return null;
  return parsed.parts.some(part => typeof part !== "string")
    ? parsed.parts
    : null;
};

const isEffort = (text: string): text is Effort =>
  (EFFORTS as readonly string[]).includes(text);

/** Checks what one item's template rendered to. */
const checkRendered = (
  field: ItemSettingField,
  template: string,
  rendered: string,
): ItemSetting<string> => {
  const text = rendered.trim();
  if (text === "") return { ok: true, value: undefined };
  // A model id has no spaces, braces or quotes; an object or list does.
  const fits = field === "effort" ? isEffort(text) : /^[^\s{}"]+$/u.test(text);
  return fits
    ? { ok: true, value: text }
    : {
        ok: false,
        error: `\`${field}: ${template}\` gave \`${text}\`, which is not ${field === "effort" ? `an effort level (${EFFORTS.join(", ")})` : "a model name"}`,
      };
};

/**
 * A node's `model` or `effort` for one item: a plain value as written, a
 * template rendered with the item. Without an item, a template renders empty.
 */
export const itemSetting = (
  field: ItemSettingField,
  value: string | undefined,
  scope: Scope,
): ItemSetting<string> => {
  if (value === undefined) return { ok: true, value: undefined };
  const parts = templateOf(value);
  if (parts === null) return { ok: true, value };
  return checkRendered(field, value, renderTemplate(parts, scope));
};

/** `itemSetting` for `effort`, as an effort level. */
export const itemEffort = (
  value: string | undefined,
  scope: Scope,
): ItemSetting<Effort> => {
  const given = itemSetting("effort", value, scope);
  if (!given.ok) return given;
  if (given.value === undefined) return { ok: true, value: undefined };
  return isEffort(given.value)
    ? { ok: true, value: given.value }
    : { ok: false, error: `\`effort\` is \`${given.value}\`` };
};

/** A `model` or `effort` template's problems on one node. */
const checkNodeField = (
  workflow: Workflow,
  says: ReturnType<typeof nodeSays>,
  id: string,
  field: ItemSettingField,
): Diagnostic[] => {
  const node = workflow.nodes[id];
  const value: unknown =
    node === undefined ? undefined : Reflect.get(node, field);
  if (node === undefined || typeof value !== "string") return [];
  const path = ["nodes", id, field];
  const parsed = parseTemplate(value);
  if (!parsed.ok) {
    return [
      error(
        "template.syntax",
        `${parsed.message} at column ${parsed.offset + 1}`,
        path,
      ),
    ];
  }
  if (parsed.parts.every(part => typeof part === "string")) return [];
  const each = forEachOf(node);
  if (each === undefined) {
    return [
      error(
        `${field}.template`,
        `\`${field}\` may be a template only on a node with \`forEach\`, reading its item, e.g. \`{{item.${field}}}\``,
        path,
      ),
    ];
  }
  const reads = parsed.parts.flatMap(part =>
    typeof part === "string" ? [] : collectPaths(part.expr),
  );
  const outside = reads.filter(([root]) => root !== "item");
  if (outside.length > 0) {
    return outside.map(segments =>
      error(
        `${field}.template`,
        `\`${describePath(segments)}\`: a \`${field}\` template reads only the item, e.g. \`{{item.${field}}}\``,
        path,
      ),
    );
  }
  const scope = { fields: itemFieldsOf(node, says) };
  const fields = reads.flatMap(segments =>
    checkItemRead(segments, scope, path),
  );
  if (fields.length > 0 || !("items" in each)) return fields;
  return each.items.flatMap((item, index) => {
    const given = checkRendered(
      field,
      value,
      renderTemplate(parsed.parts, { inputs: {}, nodes: {}, item, index }),
    );
    return given.ok
      ? []
      : [
          error(`${field}.item`, `item ${String(index)}: ${given.error}`, [
            "nodes",
            id,
            "forEach",
            "items",
            index,
          ]),
        ];
  });
};

/**
 * `model` and `effort` templates: only on a `forEach` node, reading only
 * `item`, and every written item's value a model name or an effort level.
 * `defaults:` belong to no node, so they take no template.
 */
export const checkItemSettings = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const says = nodeSays(workflow.nodes, edges);
  const defaults = FIELDS.flatMap(field => {
    const value = workflow.defaults?.[field];
    return value !== undefined && templateOf(value) !== null
      ? [
          error(
            `${field}.template`,
            `\`defaults.${field}\` applies to every node, so it can't read an item; set the template on the \`forEach\` node`,
            ["defaults", field],
          ),
        ]
      : [];
  });
  const nodes = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    isClaudeNode(node)
      ? FIELDS.flatMap(field => checkNodeField(workflow, says, id, field))
      : [],
  );
  return [...defaults, ...nodes];
};
