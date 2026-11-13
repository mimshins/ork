/**
 * @file The records `scan` prints: one per thing a free scanner found. They
 *   join the report as `scanner` records and are never part of `findings.json`
 *   (the skill's validator only accepts its own three verdicts there).
 */

export type ScannerCheck =
  | "pnpm-audit"
  | "unpinned-action"
  | "missing-permissions"
  | "pull-request-target-checkout"
  | "secret-pattern";

export type ScannerRecord = {
  source: "scanner";
  check: ScannerCheck;
  /** A fingerprint in the skill's alphabet, stable across runs. */
  fingerprint: string;
  title: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  file?: string;
  line?: number;
  /** For a secret hit: the pattern's name; never the matched value. */
  pattern?: string;
  detail?: string;
};

/** A fingerprint in the skill's alphabet (`[A-Za-z0-9._:/@+-]`) from parts. */
export const fingerprintOf = (...parts: readonly (string | number)[]): string =>
  parts
    .map(part => String(part).replaceAll(/[^A-Za-z0-9._:/@+-]+/gu, "_"))
    .join(":");
