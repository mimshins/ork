/**
 * @file `ork __onboard format [<type>…]`: a compact brief of the workflow file
 *   format for the onboarding writer, rendered from the published JSON Schema
 *   (about 158 KB pretty) as one line per field, `name*: type - description`,
 *   `*` when required, objects expanded one level
 *   (specs/cli/onboard-verbs.md#format).
 */

import { renderJsonSchema } from "@krapht/ork-schema";

type Json = Record<string, unknown>;

/** The most a whole brief may print (a test holds it). */
export const FORMAT_BRIEF_MAX_BYTES = 24 * 1024;

const MAX_DESCRIPTION = 100;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const objectOf = (value: unknown): Json => (isObject(value) ? value : {});

const objectsOf = (value: unknown): Json[] =>
  listOf(value).filter(item => isObject(item));

/** The type of a JSON Schema fragment, short. */
const typeOf = (schema: Json): string => {
  if ("const" in schema) return JSON.stringify(schema["const"]);
  const enumValues = listOf(schema["enum"]);
  if (enumValues.length > 0) return enumValues.map(String).join("|");
  const choices = objectsOf(schema["anyOf"] ?? schema["oneOf"]);
  if (choices.length > 0)
    return [...new Set(choices.map(choice => typeOf(choice)))].join(" | ");
  const type = schema["type"];
  if (Array.isArray(type)) return type.map(String).join("|");
  if (type === "array") {
    return `${isObject(schema["items"]) ? typeOf(schema["items"]) : "any"}[]`;
  }
  if (type === "object") {
    const values = schema["additionalProperties"];
    if (isObject(values) && !isObject(schema["properties"])) {
      return `map<string, ${typeOf(values)}>`;
    }
    return "object";
  }
  return typeof type === "string" ? type : "any";
};

/** The first sentence of a description, cut to a length. */
const gist = (text: unknown): string => {
  if (typeof text !== "string") return "";
  const first = text
    .replaceAll(/\s+/gu, " ")
    .trim()
    .split(/(?<=\.)\s(?=[A-Z])/u)[0];
  const line = first ?? "";
  return line.length > MAX_DESCRIPTION
    ? `${line.slice(0, MAX_DESCRIPTION - 1)}…`
    : line;
};

/** The properties an object schema, or a map of objects, expands to. */
const innerOf = (schema: Json): Json => {
  const own = objectOf(schema["properties"]);
  if (Object.keys(own).length > 0) return schema;
  const values = schema["additionalProperties"];
  return isObject(values) && isObject(values["properties"]) ? values : {};
};

const fieldLines = (
  schema: Json,
  indent: string,
  expand: boolean,
): string[] => {
  const required = new Set(listOf(schema["required"]));
  const lines: string[] = [];
  for (const [name, raw] of Object.entries(objectOf(schema["properties"]))) {
    if (name === "type" && indent === "  ") continue;
    const field = objectOf(raw);
    const note = gist(field["description"]);
    lines.push(
      `${indent}${name}${required.has(name) ? "*" : ""}: ${typeOf(field)}${note === "" ? "" : ` - ${note}`}`,
    );
    if (expand) {
      lines.push(...fieldLines(innerOf(field), `${indent}  `, false));
    }
  }
  return lines;
};

const nodeSchemas = (root: Json): Map<string, Json> => {
  const nodes = objectOf(objectOf(root["properties"])["nodes"]);
  const types = new Map<string, Json>();
  for (const node of objectsOf(
    objectOf(nodes["additionalProperties"])["oneOf"],
  )) {
    const type = objectOf(objectOf(node["properties"])["type"])["const"];
    if (typeof type === "string") types.set(type, node);
  }
  return types;
};

export type FormatBrief =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** The brief: the top level, then `types` (default: every node type). */
export const formatBrief = (types: readonly string[] = []): FormatBrief => {
  const parsed: unknown = JSON.parse(renderJsonSchema());
  const root = objectOf(parsed);
  const nodes = nodeSchemas(root);
  const unknown = types.filter(type => !nodes.has(type));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown node type ${unknown.join(", ")}. Known: ${[...nodes.keys()].join(", ")}.`,
    };
  }
  const wanted = types.length === 0 ? [...nodes.keys()] : types;
  const lines = [
    "A workflow file is YAML. `*` marks a required field.",
    "",
    "workflow",
    ...fieldLines(root, "  ", true),
  ];
  for (const type of wanted) {
    lines.push("", type, ...fieldLines(objectOf(nodes.get(type)), "  ", true));
  }
  return { ok: true, text: `${lines.join("\n")}\n` };
};
