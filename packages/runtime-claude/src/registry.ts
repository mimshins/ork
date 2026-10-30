/**
 * @file A runtime factory for every registered Claude driver (ADR-022). The
 *   record is keyed by `DriverId`, so a new driver descriptor in
 *   `@krapht/ork-integrations` does not compile until it has a factory here.
 */

import type { ClaudeRuntime } from "@krapht/ork-core";
import type { DriverId, Env } from "@krapht/ork-integrations";

import { createCliRuntime } from "./cli.ts";
import { createSdkRuntime } from "./sdk.ts";

export const RUNTIME_FACTORIES: Record<DriverId, (env: Env) => ClaudeRuntime> =
  {
    sdk: env => createSdkRuntime(env),
    cli: env => createCliRuntime({ env }),
  };

/** The runtime for a driver id, with the user's environment. */
export const createRuntime = (driver: DriverId, env: Env): ClaudeRuntime =>
  RUNTIME_FACTORIES[driver](env);
