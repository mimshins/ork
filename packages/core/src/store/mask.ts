/**
 * @file Masks secrets before anything is stored: tokens and keys in common
 *   formats, anywhere in an event's strings. The store and feedback records use
 *   the same patterns; the terminal is not masked (it is the user's own).
 */

import { SECRET_PATTERNS } from "./secret-patterns.ts";

/** Looser than the shared list, for masking only; they run first. */
const MASK_ONLY: RegExp[] = [
  /sk-ant-[\w-]{20,}/gu,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/gu,
  /\bgithub_pat_\w{20,}/gu,
  /\bxox[abprs]-[\w-]{10,}/gu,
  // The whole block, before the shared list masks only its first line.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /(?<=\bbearer\s+)[\w.~+/-]{20,}=*/giu,
  /(?<=aws_secret_access_key\s*[=:]\s*)\S+/giu,
];

/**
 * The value after a secret-sounding key, as `key=v`, `key: v` or JSON's `"key":
 * "v"`; 8 characters or more, so short words and fixtures stay. A `{{…}}`
 * template is not a value, so a workflow's `env:` stays readable.
 */
const GENERIC =
  /(?<=(?:password|passwd|secret|token|api[_-]key)["']?\s*[=:]\s*["']?)(?!\{\{)[^\s"'`&,;]{8,}/giu;

const PATTERNS: RegExp[] = [
  ...MASK_ONLY,
  ...SECRET_PATTERNS.map(
    ({ pattern }) => new RegExp(pattern.source, `${pattern.flags}g`),
  ),
  GENERIC,
];

export const MASK = "[masked]";

export const maskSecrets = (text: string): string =>
  PATTERNS.reduce((out, pattern) => out.replaceAll(pattern, MASK), text);

/** A `JSON.stringify` replacer that masks every string. */
export const maskReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "string" ? maskSecrets(value) : value;
