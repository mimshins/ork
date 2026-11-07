/**
 * @file The environment a session's prompt cache asks of Claude Code: a spec
 *   with `promptCache: "1h"` (a leader's) runs with
 *   `ENABLE_PROMPT_CACHING_1H=1`, on both drivers (specs/context.md).
 */

import type { SessionSpec } from "@krapht/ork-core";

/** Claude Code's switch for the one-hour prompt cache. */
export const PROMPT_CACHE_1H = "ENABLE_PROMPT_CACHING_1H";

/** The variables a session adds to its driver's environment. */
export const cacheEnv = (
  spec: Pick<SessionSpec, "promptCache">,
): Record<string, string> =>
  spec.promptCache === "1h" ? { [PROMPT_CACHE_1H]: "1" } : {};
