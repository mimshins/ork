/**
 * @file Markdown helpers for the audit's report writer: JSON values as lists,
 *   one-line table cells, titled sections, and a safe path read.
 */

import { isObject, str } from "./json.ts";

export const strings = (list: readonly unknown[] | undefined): string[] =>
  (list ?? []).filter(item => typeof item === "string");

export const get = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (current, key) => (isObject(current) ? current[key] : undefined),
    value,
  );

/** A table cell: one line, no pipes. */
export const cell = (value: unknown): string =>
  str(value).replaceAll("|", "\\|").replaceAll(/\s+/gu, " ").trim();

/** Lines and groups of lines, flattened. */
export const lines = (...parts: (string | string[])[]): string[] =>
  parts.flat();

/** Any JSON value as a markdown list, indented under its label. */
export const bullets = (value: unknown, depth = 0): string[] => {
  const pad = "  ".repeat(depth);
  if (Array.isArray(value)) {
    return value.flatMap(item =>
      isObject(item) || Array.isArray(item)
        ? lines(`${pad}-`, bullets(item, depth + 1))
        : [`${pad}- ${String(item)}`],
    );
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      isObject(item) || Array.isArray(item)
        ? lines(`${pad}- ${key}:`, bullets(item, depth + 1))
        : [`${pad}- ${key}: ${String(item)}`],
    );
  }
  return [`${pad}- ${String(value)}`];
};

export const section = (title: string, body: string[]): string[] => [
  `## ${title}`,
  "",
  ...(body.length === 0 ? ["None."] : body),
  "",
];
