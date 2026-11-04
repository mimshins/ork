/**
 * @file The canonical order of keys anywhere in a workflow, read from the Zod
 *   model the serializer follows, so that a document edit puts a new key where
 *   the serializer would and a canonical file stays canonical (RFC-008).
 */

import { z } from "zod";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unwrapped = (schema: z.ZodType | undefined): z.ZodType | undefined => {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    // Sound: each of these wraps exactly one schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    current = current.unwrap() as z.ZodType;
  }
  return current;
};

/** The object shapes a schema can be: one, or a union's. */
const objectsIn = (
  schema: z.ZodType | undefined,
): z.ZodObject<z.ZodRawShape>[] => {
  const plain = unwrapped(schema);
  if (plain instanceof z.ZodObject) {
    return [plain];
  }
  if (plain instanceof z.ZodUnion) {
    // Sound: a union's options are schemas.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    return (plain.options as readonly z.ZodType[]).flatMap(option =>
      objectsIn(option),
    );
  }
  return [];
};

/** Whether `object` declares this literal `type`, as a node's shape does. */
const declaresType = (
  object: z.ZodObject<z.ZodRawShape>,
  type: unknown,
): boolean => {
  const own = object.shape["type"];
  return own instanceof z.ZodLiteral && own.value === type;
};

/** The object `value` is, among those `schema` allows. */
const objectFor = (
  schema: z.ZodType | undefined,
  value: unknown,
): z.ZodObject<z.ZodRawShape> | undefined => {
  const objects = objectsIn(schema);
  const keys = isRecord(value) ? Object.keys(value) : [];
  const type = isRecord(value) ? value["type"] : undefined;
  return (
    objects.find(object => declaresType(object, type)) ??
    objects.find(object => keys.every(key => key in object.shape)) ??
    objects[0]
  );
};

/** The keys `schema` declares for `value`, in canonical order. */
export const keysOf = (
  schema: z.ZodType | undefined,
  value: unknown,
): string[] => Object.keys(objectFor(schema, value)?.shape ?? {});

/** The schema of `value`'s child at `key`, when the model says. */
export const childOf = (
  schema: z.ZodType | undefined,
  key: string | number,
  value: unknown,
): z.ZodType | undefined => {
  const plain = unwrapped(schema);
  if (plain instanceof z.ZodRecord) {
    // Sound: a record's values are schemas.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    return plain.valueType as z.ZodType;
  }
  if (plain instanceof z.ZodArray) {
    // Sound: an array's element is a schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    return plain.element as z.ZodType;
  }
  if (typeof key !== "string") return undefined;
  // Sound: an object's shape holds schemas.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return objectFor(plain, value)?.shape[key] as z.ZodType | undefined;
};

/** `value` with every object's keys in canonical order and no undefined. */
export const inCanonicalOrder = (
  value: unknown,
  schema: z.ZodType | undefined,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      inCanonicalOrder(item, childOf(schema, index, value)),
    );
  }
  if (!isRecord(value)) return value;
  const order = keysOf(schema, value);
  // From entries, as a key called `__proto__` would be lost by assigning it.
  return Object.fromEntries(
    [
      ...order.filter(known => known in value),
      ...Object.keys(value).filter(other => !order.includes(other)),
    ]
      .filter(key => value[key] !== undefined)
      .map(key => [
        key,
        inCanonicalOrder(value[key], childOf(schema, key, value)),
      ]),
  );
};

/** Two plain values alike, whatever the order of their keys. */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const left = Object.entries(a);
    return (
      left.length === Object.keys(b).length &&
      left.every(([key, value]) => sameValue(value, b[key]))
    );
  }
  return a === b;
};
