/**
 * @file Telling a process from a later one that got its id. A process id comes
 *   round again, most easily after a reboot, so a live process with a recorded
 *   id isn't proof it's the one recorded: one that started after the record was
 *   written can't be.
 */

import { execFileSync } from "node:child_process";

import { processAlive } from "./view.ts";

/** `ps` says when to the second, and clocks wander a little. */
const SLACK_MS = 2000;

/** When a process started; `undefined` when `ps` can't say. */
export const processStartedAt = (pid: number): number | undefined => {
  try {
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const at = Date.parse(started.trim());
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
