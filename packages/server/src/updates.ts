/**
 * @file What the server behind `ork ui` knows of new versions
 *   (specs/cli/updates.md): it reads the CLI's record
 *   (`~/.ork/update-check.json`) once a minute at most, and, since `ork ui` can
 *   run for days, runs the same daily check a command starts, asking whether
 *   one is due once an hour, so the machine still asks the registry at most
 *   once a day, whoever asks. Off, by the same switches as the CLI, it neither
 *   asks nor reports a newer version. It also holds the one upgrade the server
 *   runs.
 */

import {
  checkDue,
  newerVersion,
  readUpdateCache,
  refreshUpdateCache,
  registryOf,
  releaseNotes,
  type UpdateCache,
  updateCachePath,
  updateSwitchOff,
  writeUpdateCache,
} from "@krapht/ork-core";

import type { VersionInfo } from "./contract-update.ts";
import type { Install, RunningJob } from "./upgrade-job.ts";

/** How often the server asks whether the daily check is due. */
export const CHECK_DUE_EVERY_MS = 60 * 60 * 1000;

/** How long a read of the record is used before it is read again. */
export const RECORD_READ_EVERY_MS = 60 * 1000;

export type UpdateOptions = {
  /** The package's npm name, `@krapht/ork`. */
  name: string;
  /**
   * Where the switches and `ORK_UPDATE_REGISTRY` are read (default: the
   * process's).
   */
  env?: Readonly<Record<string, string | undefined>>;
  /** Asks the registry (default: the global one); tests pass a fake. */
  fetch?: typeof globalThis.fetch;
  /** The running script, which tells how Ork was installed. */
  script?: string;
  /** Runs the installer's command (default: core's); tests pass a fake. */
  install?: Install;
  /** Default {@link CHECK_DUE_EVERY_MS}. */
  checkEveryMs?: number;
  /** Default {@link RECORD_READ_EVERY_MS}. */
  readEveryMs?: number;
};

export type Updates = {
  /** What `GET /api/version` answers. */
  info: () => VersionInfo;
  /** The options, when this server checks and upgrades at all. */
  options: UpdateOptions | undefined;
  file: string;
  /** Reads the record again on the next `info`. */
  forget: () => void;
  job: () => RunningJob | null;
  setJob: (job: RunningJob) => void;
  close: () => void;
};

const NOT_HERE = "This server was not started by `ork ui`.";

/** Asks the registry when the daily check is due; never throws. */
const checkIfDue = async (
  file: string,
  options: UpdateOptions,
): Promise<boolean> => {
  try {
    const now = new Date();
    const cache = readUpdateCache(file);
    if (!checkDue(cache, now)) return false;
    // Recorded first, so a command started meanwhile doesn't ask too.
    writeUpdateCache(file, { ...cache, checkedAt: now.toISOString() });
    const registry = registryOf(options.env ?? process.env);
    await refreshUpdateCache(file, options.name, now, {
      ...(registry === undefined ? {} : { registry }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    return true;
  } catch {
    // An unwritable ~/.ork only means no banner.
    return false;
  }
};

export const createUpdates = (input: {
  version: string;
  home?: string;
  options?: UpdateOptions;
}): Updates => {
  const { version, options } = input;
  const file = updateCachePath(input.home);
  const env = options?.env ?? process.env;
  const switched = options === undefined ? null : updateSwitchOff(env);
  const reason =
    options === undefined
      ? NOT_HERE
      : switched === null
        ? null
        : `${switched} is set`;
  let record: { cache: UpdateCache | null; at: number } | null = null;
  let job: RunningJob | null = null;

  const read = (): UpdateCache | null => {
    const at = Date.now();
    const every = options?.readEveryMs ?? RECORD_READ_EVERY_MS;
    if (record === null || at - record.at >= every) {
      record = { cache: readUpdateCache(file), at };
    }
    return record.cache;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  if (options !== undefined && reason === null) {
    const due = (): void => {
      void checkIfDue(file, options).then(asked => {
        if (asked) record = null;
        return asked;
      });
    };
    due();
    timer = setInterval(due, options.checkEveryMs ?? CHECK_DUE_EVERY_MS);
    timer.unref();
  }

  return {
    info: () => {
      const cache = read();
      const newer =
        options === undefined || reason !== null
          ? null
          : newerVersion(cache, version);
      const registry = registryOf(env);
      return {
        current: version,
        latest: cache?.latest ?? null,
        newer,
        checkedAt: cache?.checkedAt ?? null,
        releaseNotes:
          newer === null || options === undefined
            ? null
            : releaseNotes(options.name, newer),
        check: reason === null ? { on: true } : { on: false, reason },
        registry: registry ?? null,
        job: job?.view() ?? null,
      };
    },
    options,
    file,
    forget: () => {
      record = null;
    },
    job: () => job,
    setJob: next => {
      job = next;
    },
    close: () => {
      clearInterval(timer);
    },
  };
};
