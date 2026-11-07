/**
 * @file A file from a newer Ork: one with a higher `schemaVersion` than this
 *   Ork reads gets one message saying so, with `ork upgrade` as the fix,
 *   instead of the schema's `expected 1` (specs/workflow-format.md).
 */

import type { z } from "zod";

/**
 * A file with a higher `schemaVersion` than this Ork reads was made by a newer
 * Ork: the message saying so, instead of `expected 1` and whatever else the
 * newer format holds. `null` when that is not why the file failed.
 */
export const newerVersion = (
  issues: readonly z.core.$ZodIssue[],
  raw: unknown,
): string | null => {
  const written =
    raw !== null && typeof raw === "object"
      ? (Reflect.get(raw, "schemaVersion") as unknown)
      : undefined;
  const issue = issues.find(
    found =>
      found.code === "invalid_value" &&
      found.path.length === 1 &&
      found.path[0] === "schemaVersion",
  );
  const [read] = issue?.code === "invalid_value" ? issue.values : [];
  if (typeof written !== "number" || typeof read !== "number") return null;
  if (written <= read) return null;
  return `this file was made by a newer Ork (\`schemaVersion: ${String(written)}\`; this one reads ${String(read)}). Upgrade with \`ork upgrade\`.`;
};
