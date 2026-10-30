/**
 * @file Where a run's feedback comes from, beyond what its events say: Ork's
 *   version (the CLI package's) and the workflow file's content hash.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SignalOptions } from "@krapht/ork-core";

/**
 * The CLI package's version: `package.json` is one folder up from both the
 * sources (`src/run/`) and the bundle (`dist/`).
 */
const readVersion = (): string | undefined => {
  for (const up of ["..", "../.."]) {
    try {
      const file = path.join(import.meta.dirname, up, "package.json");
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "name" in parsed &&
        parsed.name === "@krapht/ork" &&
        "version" in parsed &&
        typeof parsed.version === "string"
      ) {
        return parsed.version;
      }
    } catch {
      // Not here; try the next folder up.
    }
  }
  return undefined;
};

/** Ork's version and the workflow's hash, for the run's feedback records. */
export const feedbackOrigin = (workflowFile: string): SignalOptions => {
  const origin: SignalOptions = {};
  const version = readVersion();
  if (version !== undefined) origin.version = version;
  try {
    origin.workflowHash = createHash("sha256")
      .update(readFileSync(workflowFile))
      .digest("hex")
      .slice(0, 12);
  } catch {
    // The run reports a missing file itself.
  }
  return origin;
};
