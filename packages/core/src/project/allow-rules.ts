/**
 * @file Writing an "always" answer's rules (RFC-028): appends them to the
 *   project's rules file (`.ork/project.yaml`, or an attached project's own),
 *   keeping its comments, and creates the file when there is none.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROJECT_SCHEMA_VERSION, withAllowRules } from "@krapht/ork-schema";

/**
 * Adds `rules` to `permissions.allow` of `file`, skipping one already there.
 * Throws when the file can't be read, parsed or written.
 */
export const addAllowRules = (file: string, rules: readonly string[]): void => {
  const exists = existsSync(file);
  const text = exists
    ? readFileSync(file, "utf8")
    : `schemaVersion: ${PROJECT_SCHEMA_VERSION}\n`;
  const next = withAllowRules(text, rules);
  if (exists && next === text) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
};
