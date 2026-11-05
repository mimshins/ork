/**
 * @file What `ork mcp`'s tools answer with (RFC-012): a route's reply as text,
 *   with long strings cut so one answer can't fill a model's context, and the
 *   workflow format a part at a time, as the whole is about 50 KB.
 */

import { renderJsonSchema } from "@krapht/ork-schema";

import type { Reply } from "./router.ts";

/** A tool's answer: text, and whether it's an error. */
export type McpAnswer = { text: string; isError?: true };

/** How long a string can be before an answer cuts it. */
const LONGEST = 400;

/** A value with every long string cut, saying how much was left out. */
export const shrink = (value: unknown, longest = LONGEST): unknown => {
  if (typeof value === "string") {
    return value.length <= longest
      ? value
      : `${value.slice(0, longest)}… (${String(value.length - longest)} more characters)`;
  }
  if (Array.isArray(value)) return value.map(item => shrink(item, longest));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shrink(item, longest)]),
    );
  }
  return value;
};

export const answer = (value: unknown): McpAnswer => ({
  text: JSON.stringify(shrink(value)),
});

export const refused = (error: string): McpAnswer => ({
  text: error,
  isError: true,
});

/** A route's reply as an answer, `then` shaping what it gave. */
export const fromReply = async <T>(
  reply: Reply<T> | Promise<Reply<T>>,
  then: (body: T) => unknown = body => body,
): Promise<McpAnswer> => {
  const settled = await reply;
  return "error" in settled
    ? refused(settled.error)
    : answer(then(settled.body));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A field of an object, or `undefined`. */
const at = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

/** A node type's name, from its branch of the schema. */
const typeOf = (branch: unknown): string | undefined => {
  const type = at(at(at(branch, "properties"), "type"), "const");
  return typeof type === "string" ? type : undefined;
};

/**
 * The format's JSON Schema: with no node type, the workflow's own fields and
 * the node types there are; with one, that type's full schema.
 */
export const formatPart = (nodeType?: string): McpAnswer => {
  const schema: unknown = JSON.parse(renderJsonSchema());
  const oneOf = at(
    at(at(at(schema, "properties"), "nodes"), "additionalProperties"),
    "oneOf",
  );
  const branches: unknown[] = Array.isArray(oneOf) ? oneOf : [];
  const types = branches.flatMap(branch => typeOf(branch) ?? []);
  const properties = at(schema, "properties");
  if (nodeType === undefined) {
    return answer({
      ...(isRecord(schema) ? schema : {}),
      properties: {
        ...(isRecord(properties) ? properties : {}),
        nodes: {
          description:
            "A map of node ids to nodes. Ask for one node type to see its fields.",
          nodeTypes: types,
        },
      },
    });
  }
  const branch = branches.find(item => typeOf(item) === nodeType);
  return branch === undefined
    ? refused(
        `No node type \`${nodeType}\`. The types are: ${types.map(type => `\`${type}\``).join(", ")}.`,
      )
    : { text: JSON.stringify(branch) };
};
