/**
 * @file A node's `model` and `effort` as a template: read from the run's
 *   `inputs`, an upstream node's output (`{{nodes.pick.output.model}}`) or a
 *   fanned node's item (`{{item.model}}`). The compiler's checks (each read as
 *   in a prompt, `item` only on a `forEach` node, every written item's value
 *   when only the item is read), and the rendering each session plan uses,
 *   which checks the value when the node runs.
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
import { isItemRoot, itemScopes } from "./for-each.ts";
import { type Context, describePath } from "./ref-paths.ts";
import { checkTemplate } from "./templates.ts";
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
  // A model id has no spaces, braces or quotes; an object or list does. A
  // leading `-` would read as a flag of the agent CLI, and a trailing `.` is a
  // driver prefix with no model (`claude-code.`).
  const fits =
    field === "effort"
      ? isEffort(text)
      : /^[^\s{}"-]([^\s{}"]*[^\s{}".])?$/u.test(text);
  return fits
    ? { ok: true, value: text }
    : {
        ok: false,
        error: `\`${field}: ${template}\` gave \`${text}\`, which is not ${field === "effort" ? `an effort level (${EFFORTS.join(", ")})` : "a model name"}`,
      };
};

/**
 * A node's `model` or `effort` for one session: a plain value as written, a
 * template rendered with `scope` (inputs, outputs, the item). What `scope`
 * lacks renders empty.
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

/** Every path a template's parts read. */
const readsOf = (parts: readonly TemplatePart[]) =>
  parts.flatMap(part =>
    typeof part === "string" ? [] : collectPaths(part.expr),
  );

const isNodeRead = ([root, name]: readonly (string | number)[]): boolean =>
  root === "nodes" && name !== undefined;

/**
 * The first node whose output a template reads (`{{nodes.pick.output.model}}`
 * gives `pick`), or `undefined` when it reads none.
 */
export const nodeReadOf = (text: string): string | undefined => {
  const parts = templateOf(text);
  const read =
    parts === null
      ? undefined
      : readsOf(parts).find(segments => isNodeRead(segments));
  return read === undefined ? undefined : String(read[1]);
};

/** A `model` or `effort` template's problems on one node. */
const checkNodeField = (
  context: Context,
  itemOf: ReturnType<typeof itemScopes>,
  id: string,
  field: ItemSettingField,
): Diagnostic[] => {
  const node = context.workflow.nodes[id];
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
  const reads = readsOf(parsed.parts);
  // `item` and `index` off a fanned node: said once, as this field's fault.
  const misplaced =
    each === undefined
      ? reads
          .filter(([root]) => isItemRoot(root))
          .map(segments =>
            error(
              `${field}.template`,
              `\`${describePath(segments)}\`: \`item\` and \`index\` are read only on a node with \`forEach\`; here a \`${field}\` template reads \`inputs.*\` or \`nodes.<id>.output.*\``,
              path,
            ),
          )
      : [];
  const found = [
    ...misplaced,
    ...checkTemplate(id, field, value, context, itemOf(id)).filter(
      d => d.code !== "item.outside",
    ),
  ];
  const itemOnly = reads.every(([root]) => isItemRoot(root));
  if (
    found.some(d => d.severity === "error") ||
    each === undefined ||
    !("items" in each) ||
    !itemOnly
  ) {
    return found;
  }
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
 * `model` and `effort` templates: their reads checked as a prompt's (`inputs`,
 * an upstream node's output, a fanned node's `item`), and every written item's
 * value a model name or an effort level when the template reads only the item.
 * `defaults:` belong to no node, so they take no template.
 */
export const checkItemSettings = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const context: Context = { workflow, edges };
  const itemOf = itemScopes(workflow, edges);
  const defaults = FIELDS.flatMap(field => {
    const value = workflow.defaults?.[field];
    return value !== undefined && templateOf(value) !== null
      ? [
          error(
            `${field}.template`,
            `\`defaults.${field}\` applies to every node, so it can't be a template; set the template on the node, where it may read \`inputs.*\`, \`nodes.<id>.output.*\` or a \`forEach\` node's \`item\``,
            ["defaults", field],
          ),
        ]
      : [];
  });
  const nodes = Object.entries(workflow.nodes).flatMap(([id, node]) =>
    isClaudeNode(node)
      ? FIELDS.flatMap(field => checkNodeField(context, itemOf, id, field))
      : [],
  );
  return [...defaults, ...nodes];
};
