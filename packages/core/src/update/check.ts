/**
 * @file The update check (ADR-038): asks the npm registry for the package's
 *   `latest` dist-tag (an 18-byte answer; Ork sends nothing but the request),
 *   keeps the answer in `~/.ork/update-check.json`, and says when to look again
 *   and when to tell the user. The CLI runs it at most once a day in the
 *   background; `ork upgrade` and, in M2, the UI read the same cache.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isNewer } from "./version.ts";

/** How often the background check asks the registry, and repeats a notice. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const NPM_REGISTRY = "https://registry.npmjs.org";

/** What the last check found, and when the user was last told. */
export type UpdateCache = {
  /** ISO time of the last attempt, successful or not. */
  checkedAt: string;
  /** The registry's `latest` version, when the last success found one. */
  latest?: string;
  /** The version the user was last told about, and when. */
  notified?: { version: string; at: string };
};

export const updateCachePath = (home: string = homedir()): string =>
  path.join(home, ".ork", "update-check.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const notifiedOf = (value: unknown): UpdateCache["notified"] => {
  if (!isRecord(value)) return undefined;
  const version = text(value, "version");
  const at = text(value, "at");
  return version === undefined || at === undefined
    ? undefined
    : { version, at };
};

/** The cache, or `null` when there is none or it cannot be read. */
export const readUpdateCache = (file: string): UpdateCache | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const checkedAt = text(parsed, "checkedAt");
  if (checkedAt === undefined) return null;
  const latest = text(parsed, "latest");
  const notified = notifiedOf(parsed["notified"]);
  return {
    checkedAt,
    ...(latest === undefined ? {} : { latest }),
    ...(notified === undefined ? {} : { notified }),
  };
};

/** Writes the cache whole (a temporary file, then a rename). */
export const writeUpdateCache = (file: string, cache: UpdateCache): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(temporary, file);
};

const age = (iso: string, now: Date): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Infinity : now.getTime() - time;
};

/** Whether it is time to ask the registry again. */
export const checkDue = (cache: UpdateCache | null, now: Date): boolean =>
  cache === null || age(cache.checkedAt, now) >= UPDATE_INTERVAL_MS;

export type FetchLatestOptions = {
  registry?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/** The package's `latest` version on the registry, or `null` on any failure. */
export const fetchLatest = async (
  name: string,
  options: FetchLatestOptions = {},
): Promise<string | null> => {
  const registry = (options.registry ?? NPM_REGISTRY).replace(/\/+$/u, "");
  const get = options.fetch ?? globalThis.fetch;
  try {
    const response = await get(`${registry}/-/package/${name}/dist-tags`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    if (!response.ok) return null;
    const tags: unknown = await response.json();
    return (isRecord(tags) ? text(tags, "latest") : undefined) ?? null;
  } catch {
    return null;
  }
};

/**
 * Asks the registry and records the answer. A failed check is recorded too, so
 * an offline machine is not asked again until the interval passes; the last
 * known `latest` is kept.
 */
export const refreshUpdateCache = async (
  file: string,
  name: string,
  now: Date,
  options: FetchLatestOptions = {},
): Promise<UpdateCache> => {
  const before = readUpdateCache(file);
  const latest = (await fetchLatest(name, options)) ?? before?.latest;
  const cache: UpdateCache = {
    ...before,
    checkedAt: now.toISOString(),
    ...(latest === undefined ? {} : { latest }),
  };
  writeUpdateCache(file, cache);
  return cache;
};

/** The newer version the cache knows of, if any. */
export const newerVersion = (
  cache: UpdateCache | null,
  current: string,
): string | null =>
  cache?.latest !== undefined && isNewer(cache.latest, current)
    ? cache.latest
    : null;

/**
 * The version to tell the user about now: newer than theirs, and not already
 * told today. `null` when there is nothing to say.
 */
export const pendingNotice = (
  cache: UpdateCache | null,
  current: string,
  now: Date,
): string | null => {
  const newer = newerVersion(cache, current);
  if (newer === null) return null;
  const told = cache?.notified;
  const toldToday =
    told?.version === newer && age(told.at, now) < UPDATE_INTERVAL_MS;
  return toldToday ? null : newer;
};
