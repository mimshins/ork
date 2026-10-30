/**
 * @file Masks secrets before anything is stored: tokens and keys in common
 *   formats, anywhere in an event's strings. The store and feedback records use
 *   the same patterns; the terminal is not masked (it is the user's own).
 */

const PATTERNS: RegExp[] = [
  /sk-ant-[\w-]{20,}/gu,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/gu,
  /\bgithub_pat_\w{20,}/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bxox[abprs]-[\w-]{10,}/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /(?<=\bbearer\s+)[\w.~+/-]{20,}=*/giu,
  /(?<=aws_secret_access_key\s*[=:]\s*)\S+/giu,
];

export const MASK = "[masked]";

export const maskSecrets = (text: string): string =>
  PATTERNS.reduce((out, pattern) => out.replaceAll(pattern, MASK), text);

/** A `JSON.stringify` replacer that masks every string. */
export const maskReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "string" ? maskSecrets(value) : value;
