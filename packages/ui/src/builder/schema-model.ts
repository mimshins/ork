/**
 * @file What a workflow's JSON Schema says a value is, for the builder's
 *   generated forms (RFC-008): a new field in the format gets a control with no
 *   UI work. Everything here is plain data, so it's tested without a page.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

export type Choice = { value: unknown; label: string };

export type FieldKind =
  | { kind: "text"; pattern?: string | undefined }
  | { kind: "number"; integer: boolean }
  | { kind: "choice"; options: readonly Choice[] }
  | {
      kind: "object";
      fields: readonly { key: string; schema: JsonSchema; required: boolean }[];
    }
  | { kind: "list"; item: JsonSchema; fixed?: number | undefined }
  | { kind: "record"; value: JsonSchema }
  | { kind: "variants"; variants: readonly JsonSchema[] }
  /** Anything at all: a list or number as JSON, else a string. */
  | { kind: "free" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaList = (value: unknown): JsonSchema[] =>
  Array.isArray(value) ? value.filter(item => isRecord(item)) : [];

export const descriptionOf = (schema: JsonSchema): string | undefined =>
  typeof schema["description"] === "string" ? schema["description"] : undefined;

const wordFor = (value: unknown): string => {
  if (value === true) return "On";
  if (value === false) return "Off";
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
};

const choicesOf = (schema: JsonSchema): Choice[] | undefined => {
  const values: unknown[] | undefined = Array.isArray(schema["enum"])
    ? schema["enum"]
    : "const" in schema
      ? [schema["const"]]
      : schema["type"] === "boolean"
        ? [true, false]
        : undefined;
  return values?.map(value => ({ value, label: wordFor(value) }));
};

const unionOf = (schema: JsonSchema): JsonSchema[] => [
  ...schemaList(schema["anyOf"]),
  ...schemaList(schema["oneOf"]),
];

/** What a schema makes of a value. */
export const kindOf = (schema: JsonSchema): FieldKind => {
  const union = unionOf(schema);
  if (union.length > 0) {
    const flat = union.map(option => choicesOf(option));
    if (flat.every(choices => choices !== undefined)) {
      return { kind: "choice", options: flat.flat() };
    }
    const [only] = union;
    return union.length === 1 && only !== undefined
      ? kindOf(only)
      : { kind: "variants", variants: union };
  }
  const choices = choicesOf(schema);
  if (choices !== undefined) return { kind: "choice", options: choices };
  if (schema["type"] === "string") {
    return {
      kind: "text",
      pattern:
        typeof schema["pattern"] === "string" ? schema["pattern"] : undefined,
    };
  }
  if (schema["type"] === "number" || schema["type"] === "integer") {
    return { kind: "number", integer: schema["type"] === "integer" };
  }
  if (schema["type"] === "array") {
    const prefix = schemaList(schema["prefixItems"]);
    const [first] = prefix;
    if (first !== undefined) {
      return { kind: "list", item: first, fixed: prefix.length };
    }
    return {
      kind: "list",
      item: isRecord(schema["items"]) ? schema["items"] : {},
    };
  }
  if (schema["type"] === "object") {
    if (isRecord(schema["properties"])) {
      const required = Array.isArray(schema["required"])
        ? schema["required"]
        : [];
      return {
        kind: "object",
        fields: Object.entries(schema["properties"]).flatMap(([key, field]) =>
          isRecord(field)
            ? [{ key, schema: field, required: required.includes(key) }]
            : [],
        ),
      };
    }
    return {
      kind: "record",
      value: isRecord(schema["additionalProperties"])
        ? schema["additionalProperties"]
        : {},
    };
  }
  return { kind: "free" };
};

/** Whether `value` fits this schema, closely enough to choose a variant. */
const fits = (schema: JsonSchema, value: unknown): boolean => {
  const kind = kindOf(schema);
  switch (kind.kind) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "choice":
      return kind.options.some(option => option.value === value);
    case "list":
      return Array.isArray(value);
    case "object":
    case "record":
      return isRecord(value);
    case "variants":
      return kind.variants.some(variant => fits(variant, value));
    case "free":
      return true;
    default:
      return false;
  }
};

/** The variant a value is, or the first. */
export const variantFor = (
  variants: readonly JsonSchema[],
  value: unknown,
): number => {
  const found = variants.findIndex(variant => fits(variant, value));
  return found === -1 ? 0 : found;
};

const WORDS: readonly (readonly [string, string])[] = [
  ["text", "Text"],
  ["number", "Number"],
  ["choice", "Choice"],
  ["list", "List"],
  ["object", "Details"],
  ["record", "Named values"],
  ["variants", "Other"],
  ["free", "Anything"],
];

/** A variant's name, for choosing between them. */
export const variantWord = (schema: JsonSchema): string => {
  const { kind } = kindOf(schema);
  return WORDS.find(([key]) => key === kind)?.[1] ?? kind;
};

/** What a newly chosen variant starts as. */
export const emptyFor = (schema: JsonSchema): unknown => {
  const kind = kindOf(schema);
  switch (kind.kind) {
    case "number":
      return 0;
    case "choice":
      return kind.options[0]?.value;
    case "list":
      return [];
    case "object":
    case "record":
      return {};
    case "text":
    case "variants":
    case "free":
      return "";
    default:
      return kind satisfies never;
  }
};

/** A choice's value as a select holds it. */
export const choiceKey = (value: unknown): string =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : "";

const LABELS: Readonly<Record<string, string>> = {
  budgetUsd: "Budget (USD)",
  budgetTokens: "Budget (tokens)",
  plainEnv: "Plain environment",
  env: "Environment",
  cwd: "Working folder",
  maxRounds: "Max rounds",
  maxTurns: "Max turns",
  maxMessages: "Max messages",
  dayUsd: "Per day (USD)",
  dayTokens: "Per day (tokens)",
  weekUsd: "Per week (USD)",
  monthUsd: "Per month (USD)",
};

/** A field's label: `maxTurns` reads as "Max turns". */
export const labelOf = (key: string): string => {
  const known = LABELS[key];
  if (known !== undefined) return known;
  const words = key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

const MULTILINE = new Set([
  "prompt",
  "instructions",
  "question",
  "script",
  "body",
  "command",
]);

/** Whether a text field needs room for more than a line. */
export const isMultiline = (key: string, value: unknown): boolean =>
  MULTILINE.has(key) || (typeof value === "string" && value.includes("\n"));

/** Text that reads back as this exact number, so `1.10` stays text. */
const isExactNumber = (text: string): boolean =>
  Number.isFinite(Number(text)) && String(Number(text)) === text;

/**
 * What's typed in a free-form field. Numbers, `true`, `false`, `null` and JSON
 * that starts `[`, `{` or `"` are read as that; anything else is the text as
 * typed. Quotes make text of what would otherwise read as something else.
 */
export const readFree = (typed: string): unknown => {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (isExactNumber(trimmed)) return Number(trimmed);
  if (!/^[[{"]/u.test(trimmed)) return typed;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return typed;
  }
};

/** A free-form value as it's typed, so that reading it gives it back. */
export const showFree = (value: unknown): string => {
  if (value === undefined) return "";
  return typeof value === "string" && readFree(value) === value
    ? value
    : JSON.stringify(value);
};

/** The node schema for a type, from the workflow's schema. */
export const nodeSchemaOf = (
  root: JsonSchema,
  type: string,
): JsonSchema | undefined => {
  const nodes = isRecord(root["properties"])
    ? root["properties"]["nodes"]
    : undefined;
  const value = isRecord(nodes) ? nodes["additionalProperties"] : undefined;
  return isRecord(value)
    ? unionOf(value).find(option => {
        const props = option["properties"];
        const own = isRecord(props) ? props["type"] : undefined;
        return isRecord(own) && own["const"] === type;
      })
    : undefined;
};

/** Every node type the format has, in its order. */
export const nodeTypesOf = (root: JsonSchema): string[] => {
  const nodes = isRecord(root["properties"])
    ? root["properties"]["nodes"]
    : undefined;
  const value = isRecord(nodes) ? nodes["additionalProperties"] : undefined;
  return isRecord(value)
    ? unionOf(value).flatMap(option => {
        const props = option["properties"];
        const own = isRecord(props) ? props["type"] : undefined;
        return isRecord(own) && typeof own["const"] === "string"
          ? [own["const"]]
          : [];
      })
    : [];
};
