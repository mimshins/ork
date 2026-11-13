/**
 * @file The well-known credential formats, kept as data so a new one is one
 *   line: `maskSecrets` masks them before anything is stored, and the
 *   repository's security audit (`tools/audit`) looks for them in tracked
 *   files. Provider formats only, at the audit's thresholds; a generic
 *   "password = …" rule would flag every test fixture, so the masker adds its
 *   own generic forms. A hit is reported by the pattern's `name`, never the
 *   matched text.
 */

export type SecretPattern = { name: string; pattern: RegExp };

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u },
  {
    name: "github-fine-grained-token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/u,
  },
  { name: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/u },
  {
    name: "openai-api-key",
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{40,}/u,
  },
  { name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
  { name: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/u },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
  { name: "stripe-live-key", pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/u },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/u,
  },
];
