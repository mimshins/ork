/**
 * @file The adapter of every registered agent driver (ADR-022, RFC-014), and
 *   the runtime the session runner makes of it. The record is keyed by
 *   `DriverId`, so a new driver descriptor in `@krapht/ork-integrations` does
 *   not compile until it has an entry here. A driver with no adapter yet
 *   (`null`) ends every session at once with a driver error that says so, and
 *   spends nothing.
 */

import type { AgentRuntime } from "@krapht/ork-core";
import type { DriverId, Env } from "@krapht/ork-integrations";

import type { CliAdapter } from "./adapter.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { commandCodeAdapter } from "./adapters/command-code.ts";
import { openCodeAdapter } from "./adapters/open-code.ts";
import { driverFailure } from "./session-leg.ts";
import { createSessionRuntime } from "./session-runner.ts";

/** The message a session on a driver with no adapter yet ends with. */
export const notBuiltYet = (driver: DriverId): string =>
  `The ${driver} driver is not built yet; use claude-code.`;

const notBuilt = (driver: DriverId): AgentRuntime => ({
  driver,
  start: () => ({
    // oxlint-disable-next-line typescript/require-await -- one event, already known
    events: (async function* () {
      yield driverFailure(notBuiltYet(driver));
    })(),
    send: () => {
      // Nothing runs, so nothing reads it.
    },
    interrupt: () => Promise.resolve(),
  }),
});

export const ADAPTERS: Record<DriverId, CliAdapter | null> = {
  "claude-code": claudeCodeAdapter,
  "open-code": openCodeAdapter,
  "command-code": commandCodeAdapter,
};

/**
 * The runtime for a driver id, with the user's environment and the project's
 * runs folder (where a Command Code lease is recorded).
 */
export const createRuntime = (
  driver: DriverId,
  env: Env,
  runs?: string,
): AgentRuntime => {
  const adapter = ADAPTERS[driver];
  return adapter === null
    ? notBuilt(driver)
    : createSessionRuntime(adapter, {
        env,
        ...(runs === undefined ? {} : { runs }),
      });
};
