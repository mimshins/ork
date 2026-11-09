/**
 * @file What the builder means by `forEach` (RFC-013), apart from how it looks:
 *   which lists a node can read, the shape a new list is declared with, what
 *   changing the kind of fan-out keeps, and where `{{item}}` may be offered.
 *   Plain data, so it's tested without a page.
 */

import type { SaidField, WorkflowGraph } from "@krapht/ork-server/client";

import { saysOf } from "./condition-model.ts";
import { type JsonSchema, kindOf, nodeSchemaOf } from "./schema-model.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A list a node can read: one list field of a node that runs before it. */
export type ListChoice = {
  node: string;
  field: string;
  /** What each item has; none for `{ list: {} }`. */
  items: readonly SaidField[];
  /** The whole template, as `from` holds it. */
  template: string;
};

/** The nodes with a path of edges, none of them a loop, to `id`. */
export const runsBefore = (
  graph: WorkflowGraph,
  id: string,
): ReadonlySet<string> => {
  const seen = new Set<string>();
  const queue = [id];
  for (const at of queue) {
    for (const edge of graph.edges) {
      if (
        edge.to === at &&
        edge.maxRounds === undefined &&
        !seen.has(edge.from)
      ) {
        seen.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  seen.delete(id);
  return seen;
};

/** The list fields of the nodes that run before `id`: no text, number or value. */
export const listsBefore = (
  graph: WorkflowGraph,
  id: string,
): readonly ListChoice[] => {
  const before = runsBefore(graph, id);
  return graph.nodes
    .filter(node => before.has(node.id))
    .flatMap(node =>
      saysOf(graph, node.id).fields.flatMap(({ field, items }) =>
        items === undefined
          ? []
          : [
              {
                node: node.id,
                field,
                items,
                template: `{{nodes.${node.id}.output.${field}}}`,
              },
            ],
      ),
    );
};

export type EachKind = "once" | "items" | "from";

export const eachKindOf = (value: unknown): EachKind => {
  if (!isRecord(value)) return "once";
  return "from" in value ? "from" : "items" in value ? "items" : "once";
};

/** Default for a new source: a few, and it's there to change. */
const STARTING_MAX = 10;

/** `forEach` after choosing a kind: `maxParallel` and `onFailure` carry over. */
export const withEachKind = (
  value: unknown,
  kind: EachKind,
): Record<string, unknown> | undefined => {
  if (kind === "once") return undefined;
  const own = isRecord(value) ? value : {};
  const kept = Object.fromEntries(
    Object.entries(own).filter(
      ([key]) => key === "maxParallel" || key === "onFailure",
    ),
  );
  return kind === "items"
    ? { items: [""], ...kept }
    : { from: "", maxItems: STARTING_MAX, ...kept };
};

/** A whole number above 0 as typed, else `undefined`. */
export const wholeNumber = (typed: string): number | undefined => {
  const number = Number(typed.trim());
  return typed.trim() !== "" && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
};

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/** What a declared item field may be. */
export const ITEM_TYPES = ["string", "number", "integer", "boolean"] as const;

export type ItemShape = Readonly<Record<string, string>>;

/**
 * The item fields as typed: `title, files:number`. The shape they make, and a
 * problem for each entry that can't be one. An entry with no type is a string.
 */
export const readItemFields = (
  typed: string,
): { shape: ItemShape; problems: readonly string[] } => {
  // A Map, since `name in {}` sees `constructor` and `__proto__` is no key.
  const shape = new Map<string, string>();
  const problems: string[] = [];
  for (const entry of typed.split(",")) {
    const text = entry.trim();
    if (text === "") continue;
    const [name = "", type = "string", ...rest] = text
      .split(":")
      .map(part => part.trim());
    if (!NAME.test(name) || rest.length > 0) {
      problems.push(
        `\`${text}\` isn't a field name. Use letters, digits, _ or -, then an optional :type.`,
      );
    } else if (!ITEM_TYPES.some(known => known === type)) {
      problems.push(
        `\`${text}\` isn't a type. Use string, number, integer or boolean.`,
      );
    } else if (shape.has(name)) {
      problems.push(`\`${name}\` is listed twice.`);
    } else {
      shape.set(name, type);
    }
  }
  return { shape: Object.fromEntries(shape), problems };
};

/** Whether a name can be a declared field. */
export const isFieldName = (name: string): boolean => NAME.test(name);

/** Whether this node can declare a list in its `output.schema`. */
export const canDeclareList = (
  type: string,
  canDeclare: boolean,
  hasOutput: boolean,
): boolean => hasOutput && (canDeclare || type.startsWith("claude."));

/**
 * What a node's list field is called in a condition: tools put theirs under
 * `json`.
 */
export const listField = (type: string, name: string): string =>
  type.startsWith("claude.") ? name : `json.${name}`;

/** The keys the entries of a static list all have, as `{{item.<key>}}`. */
const sharedKeys = (items: unknown): readonly string[] => {
  const entries = Array.isArray(items) ? items : [];
  const keys = entries.map(entry =>
    isRecord(entry) ? Object.keys(entry) : [],
  );
  const [first = []] = keys;
  return first.filter(key => keys.every(own => own.includes(key)));
};

/** The fields `{{item.<field>}}` can read on a fanned node, if anything says. */
export const itemFieldsOf = (
  graph: WorkflowGraph,
  forEach: unknown,
): readonly string[] => {
  if (!isRecord(forEach)) return [];
  if ("items" in forEach) return sharedKeys(forEach["items"]);
  const from = forEach["from"];
  if (typeof from !== "string") return [];
  const found = /^\{\{\s*nodes\.([^.\s]+)\.output\.(.+?)\s*\}\}$/u.exec(from);
  const field = saysOf(graph, found?.[1] ?? "").fields.find(
    ({ field: name }) => name === found?.[2],
  );
  return field?.items?.map(item => item.field) ?? [];
};

/** The fields whose text can read an item, as the compiler allows. */
const ITEM_KEYS = new Set([
  "prompt",
  "command",
  "arguments",
  "inputs",
  "env",
  "ref",
]);

/**
 * A field's hint with the sentence about `{{item}}` added, for a field on a
 * fanned node that can read it; the hint as it was for any other.
 */
export const itemHint = (
  graph: WorkflowGraph,
  path: readonly (string | number)[],
  forEach: unknown,
  description?: string,
): string | undefined => {
  const [root, , key] = path;
  if (root !== "nodes" || typeof key !== "string" || !ITEM_KEYS.has(key)) {
    return description;
  }
  if (!isRecord(forEach)) return description;
  const fields = itemFieldsOf(graph, forEach);
  const reads = [
    "`{{item}}` and `{{index}}`",
    ...(fields.length === 0
      ? []
      : [fields.map(field => `\`{{item.${field}}}\``).join(", ")]),
  ].join(", and ");
  return [description, `Reads ${reads}.`].filter(Boolean).join(" ");
};

/** What the schema says of a written list's `items`, for its rows. */
export const itemsSchemaOf = (forEach: JsonSchema): JsonSchema => {
  const kind = kindOf(forEach);
  const first = kind.kind === "variants" ? kind.variants[0] : undefined;
  const props = first === undefined ? undefined : first["properties"];
  const own = isRecord(props) ? props["items"] : undefined;
  return isRecord(own) ? own : {};
};

/** A node that can declare a list, with its type and the fields it has. */
export type Holder = { id: string; type: string; fields: readonly string[] };

/**
 * The nodes that can declare a list for `id` to read: one that runs before it
 * (a path of edges, no loop among them), of a type with an `output.schema`, and
 * not a fanned node, whose output is only its items' results.
 */
export const holdersOf = (
  graph: WorkflowGraph,
  root: JsonSchema | null,
  id: string,
): readonly Holder[] => {
  const before = runsBefore(graph, id);
  return graph.nodes.flatMap(({ id: node, type }) => {
    const says = saysOf(graph, node);
    const own = root === null ? undefined : nodeSchemaOf(root, type);
    const props = own === undefined ? undefined : own["properties"];
    return before.has(node) &&
      !says.fields.some(({ kind }) => kind === "statuses") &&
      canDeclareList(
        type,
        says.canDeclare,
        isRecord(props) && "output" in props,
      )
      ? [
          {
            id: node,
            type,
            fields: says.fields.map(({ field }) =>
              field.replace(/^json\./u, ""),
            ),
          },
        ]
      : [];
  });
};
