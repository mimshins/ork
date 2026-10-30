/**
 * @file Small helpers for reading the JSON and text that CLIs print, shared by
 *   the integrations' doctor checks.
 */

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** An own property of an object, or `undefined`. */
export const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" && Object.hasOwn(value, key)
    ? (Reflect.get(value, key) as unknown)
    : undefined;

export const firstLine = (text: string): string =>
  text.trim().split("\n")[0] ?? "";
