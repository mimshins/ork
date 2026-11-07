/**
 * @file Telling a process from a later one that got its id. A process id comes
 *   round again, most easily after a reboot, so a live process with a recorded
 *   id isn't proof it's the one recorded. A run records its process's start
 *   beside its id, and a process whose start differs is another one: on Linux
 *   the start in clock ticks since boot from `/proc/<pid>/stat`, with the
 *   boot's id; elsewhere `ps`'s start time, to the second. Where neither can be
 *   read, a live process counts, as it did before.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Reads the start of the process with an id; `undefined` when it can't. */
export type ProcessStartReader = (pid: number) => string | undefined;

/** Whether a process is running: ours, or another user's (alive, not ours). */
export const processAlive = (pid: number): boolean => {
  // 0 and below signal a process group, which is always there; NaN isn't an id.
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's process: alive, but not ours to signal.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** `ps`'s `lstart` in UTC: when a process started, to the second. */
const lstartOf = (pid: number): string =>
  execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    stdio: ["ignore", "pipe", "ignore"],
  });

/** `ps:<seconds since the epoch>` from `ps -o lstart=` printed in UTC. */
export const startFromLstart = (lstart: string): string | undefined => {
  const at = Date.parse(`${lstart.trim()} UTC`);
  return Number.isNaN(at) ? undefined : `ps:${String(Math.floor(at / 1000))}`;
};

/**
 * `linux:<boot id>:<ticks>` from `/proc/<pid>/stat`: field 22 is the start in
 * clock ticks since boot. The name (field 2) can hold spaces and brackets, so
 * the fields are counted from its closing bracket.
 */
export const startFromStat = (
  stat: string,
  bootId: string,
): string | undefined => {
  const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = after[22 - 3] ?? "";
  return /^\d+$/u.test(ticks) ? `linux:${bootId}:${ticks}` : undefined;
};

let boot: string | undefined;

/** This boot's id, so ticks since one boot don't match another's. */
const bootId = (): string => {
  boot ??= (() => {
    try {
      return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    } catch {
      return "";
    }
  })();
  return boot;
};

/**
 * The start of a process, from `/proc` on Linux (exact, and not moved by the
 * clock) and from `ps` elsewhere (macOS has no `/proc`); `undefined` when the
 * process is gone or its start can't be read.
 */
export const processStartOf: ProcessStartReader = (
  pid: number,
): string | undefined => {
  if (!processAlive(pid)) return undefined;
  try {
    return process.platform === "linux"
      ? startFromStat(
          readFileSync(`/proc/${String(pid)}/stat`, "utf8"),
          bootId(),
        )
      : startFromLstart(lstartOf(pid));
  } catch {
    // Gone since, or nothing here to read it with.
    return undefined;
  }
};

let own: { start: string | undefined } | undefined;

/** This process's start, read once: what a run records beside its id. */
export const ownProcessStart = (): string | undefined => {
  own ??= { start: processStartOf(process.pid) };
  return own.start;
};

/**
 * Whether two starts are one process's: the same on Linux; on `ps`, within a
 * second, as it prints whole seconds. `undefined` when they were read in
 * different ways and can't be compared.
 */
export const sameStart = (a: string, b: string): boolean | undefined => {
  const [kindA = "", restA = ""] = a.split(/:(.*)/su);
  const [kindB = "", restB = ""] = b.split(/:(.*)/su);
  if (kindA !== kindB) return undefined;
  if (kindA !== "ps") return a === b;
  return Math.abs(Number(restA) - Number(restB)) <= 1;
};

/** How long a start read for a check is trusted, when it matched. */
const RECENT_MS = 1000;

const recent = new Map<number, { start: string | undefined; at: number }>();

/**
 * The default reader for checks, which `ork ps`, the overview stream and the
 * panels make often: a start read in the last second is used again, but only to
 * say a process is still the recorded one; a mismatch is read afresh.
 */
const checkedStart = (pid: number, recorded: string): boolean | undefined => {
  const now = Date.now();
  const cached = recent.get(pid);
  if (
    cached !== undefined &&
    now - cached.at < RECENT_MS &&
    cached.start !== undefined &&
    sameStart(recorded, cached.start) === true
  ) {
    return true;
  }
  const start = processStartOf(pid);
  if (recent.size > 256) recent.clear();
  recent.set(pid, { start, at: now });
  return start === undefined ? undefined : sameStart(recorded, start);
};

/**
 * Whether a run's process is still there: alive, and, when the run recorded its
 * start, started then. A run recorded before starts were, or one whose start
 * can't be read now, goes by the id alone.
 */
export const runProcessAlive = (
  run: { pid: number; processStart?: string },
  startOf?: ProcessStartReader,
): boolean => {
  if (!processAlive(run.pid)) return false;
  if (run.processStart === undefined) return true;
  if (startOf === undefined) {
    return checkedStart(run.pid, run.processStart) !== false;
  }
  const start = startOf(run.pid);
  return start === undefined || sameStart(run.processStart, start) !== false;
};

/** `ps` says when to the second, and clocks wander a little. */
const SLACK_MS = 2000;

/** When a process started; `undefined` when `ps` can't say. */
export const processStartedAt = (pid: number): number | undefined => {
  try {
    const at = Date.parse(`${lstartOf(pid).trim()} UTC`);
    return Number.isNaN(at) ? undefined : at;
  } catch {
    return undefined;
  }
};

/**
 * Whether the process that recorded something at `at` is still there. When `ps`
 * can't say, a live process counts, which only ever keeps something waiting.
 */
export const stillTheSameProcess = (
  pid: number,
  at: string,
  startedAt: (pid: number) => number | undefined = processStartedAt,
): boolean => {
  if (!processAlive(pid)) return false;
  const started = startedAt(pid);
  return started === undefined || started <= Date.parse(at) + SLACK_MS;
};
