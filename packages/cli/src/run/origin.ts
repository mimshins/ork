/**
 * @file Where a run's feedback comes from, beyond what its events say: Ork's
 *   version (bound from the CLI's `package.json`) and the workflow file's
 *   content hash.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { SignalOptions } from "@krapht/ork-core";

import { ORK_VERSION } from "../__build_info__.ts";

/** Ork's version and the workflow's hash, for the run's feedback records. */
export const feedbackOrigin = (workflowFile: string): SignalOptions => {
  const origin: SignalOptions = { version: ORK_VERSION };
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
