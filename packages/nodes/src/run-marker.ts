/**
 * @file The marker a run leaves on its sessions and programs (ADR-047), and the
 *   stores it guards: the commands that act as the user refuse in the stores of
 *   the runs that started a process, and everywhere under a marker that lists
 *   none, which an older `ork` sets.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

import { type Environ, storePath } from "@krapht/ork-core";

/** Set for a program in a run. */
export const RUN_ENV = "ORK_RUN";

/** Set for a Claude session. It says no more than that: no run, no node. */
export const SESSION_ENV = "ORK_SESSION";

/**
 * The stores whose runs started a session or program, as a JSON array of real
 * paths: the commands that act as the user refuse only in these.
 */
export const GUARDED_STORES_ENV = "ORK_GUARDED_STORES";

/**
 * The variable that says a program in a run or a session started this process,
 * or `null` when none does.
 */
export const runMarkerIn = (env: Environ): string | null =>
  [RUN_ENV, SESSION_ENV].find(name => env[name] !== undefined) ?? null;

/** The stores `env` lists, or `undefined` when it lists none or garbles it. */
const listIn = (env: Environ): string[] | undefined => {
  const text = env[GUARDED_STORES_ENV];
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) &&
      value.every((item): item is string => typeof item === "string")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

/** A store file's real path, so a symlinked `~/.ork` is the same store. */
export const realStore = (store: string): string => {
  try {
    return realpathSync(store);
  } catch {
    return path.resolve(store);
  }
};

/**
 * The stores a run that started this process is in: `null` when no run did, and
 * `"all"` when one did but listed none (an older `ork`), which fails closed.
 */
export const guardedStoresIn = (
  env: Environ,
): readonly string[] | "all" | null =>
  runMarkerIn(env) === null ? null : (listIn(env) ?? "all");

/** Whether a run in `store` (a store file) started this process. */
export const storeGuarded = (env: Environ, store: string): boolean => {
  const guarded = guardedStoresIn(env);
  return (
    guarded === "all" ||
    (guarded !== null && guarded.includes(realStore(store)))
  );
};

/**
 * What a run in `store` (default: the user's) tells its sessions and programs:
 * the stores it inherited, and its own. Nothing when it inherited "all", so
 * that holds.
 */
export const guardOf = (
  env: Environ,
  store: string = storePath(),
): Record<string, string> =>
  guardedStoresIn(env) === "all"
    ? {}
    : {
        [GUARDED_STORES_ENV]: JSON.stringify([
          ...new Set([...(listIn(env) ?? []), realStore(store)]),
        ]),
      };
