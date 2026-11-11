/**
 * @file The new-version notice (ADR-038). At most once a day a command starts a
 *   detached copy of `ork` that asks the npm registry for the latest version
 *   and records it in `~/.ork/update-check.json`, so no command waits on the
 *   network; a later command, when a newer version is known, ends with one line
 *   on stderr (once a day). Off in CI, without a terminal, with `--json`, and
 *   with `ORK_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`.
 */

import { spawn } from "node:child_process";
import { styleText } from "node:util";

import {
  checkDue,
  DETACHED_ENV,
  isSwitchedOn,
  pendingNotice,
  readUpdateCache,
  refreshUpdateCache,
  registryOf,
  updateCachePath,
  updateSwitchOff,
  writeUpdateCache,
} from "@krapht/ork-core";

import { ORK_NAME, ORK_VERSION } from "../__build_info__.ts";
import { plainEnv } from "../term/mode.ts";

/** Set in the background copy of `ork` that only runs the check. */
export const UPDATE_CHILD_ENV = "ORK_UPDATE_CHECK_CHILD";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Why the automatic check is off for this command, or `null` when it is on: the
 * environment's switches (core's, which `ork ui` reads too), then where a
 * notice on stderr would go.
 */
export const updateCheckOff = (
  env: Env,
  argv: readonly string[],
  terminal: boolean,
): string | null => {
  const switched = updateSwitchOff(env);
  if (switched !== null) return switched === "CI" ? "in CI" : "turned off";
  if (isSwitchedOn(env[DETACHED_ENV]) || !terminal) return "no terminal";
  if (argv.includes("--json")) return "JSON output";
  if (argv[0] === "upgrade") return "ork upgrade checks for itself";
  if (argv[0] === "ui" && argv.includes("--serve")) {
    return "ork ui's server checks for itself";
  }
  return null;
};

/** The notice's text. */
export const updateNotice = (latest: string, current: string): string =>
  `Ork ${latest} is out (you have ${current}). Upgrade with: ork upgrade`;

/**
 * Starts the background check when one is due. Records the attempt first, so
 * commands started in the next moments do not start one too.
 */
export const startUpdateCheck = (
  file: string = updateCachePath(),
  now: Date = new Date(),
): void => {
  try {
    const cache = readUpdateCache(file);
    if (!checkDue(cache, now)) return;
    writeUpdateCache(file, { ...cache, checkedAt: now.toISOString() });
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1] ?? ""],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, [UPDATE_CHILD_ENV]: "1" },
      },
    );
    child.on("error", () => {
      // A failed check is retried after the interval; nothing to tell.
    });
    child.unref();
  } catch {
    // An unwritable ~/.ork only means no notice.
  }
};

/** The background copy's whole job: ask the registry, record the answer. */
export const runUpdateChild = async (): Promise<void> => {
  const registry = registryOf(process.env);
  await refreshUpdateCache(updateCachePath(), ORK_NAME, new Date(), {
    current: ORK_VERSION,
    ...(registry === undefined ? {} : { registry }),
  });
};

/** Prints the notice when a newer version is known and not told today. */
export const showUpdateNotice = (
  file: string = updateCachePath(),
  now: Date = new Date(),
): void => {
  try {
    const cache = readUpdateCache(file);
    const latest = pendingNotice(cache, ORK_VERSION, now);
    if (cache === null || latest === null) return;
    const text = updateNotice(latest, ORK_VERSION);
    process.stderr.write(
      `\n${plainEnv() ? text : styleText("yellow", text, { stream: process.stderr })}\n`,
    );
    writeUpdateCache(file, {
      ...cache,
      notified: { version: latest, at: now.toISOString() },
    });
  } catch {
    // The notice is a courtesy; never fail a command over it.
  }
};
