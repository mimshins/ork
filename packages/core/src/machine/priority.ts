/**
 * @file Starting a child at the project's priority (`priority:`): `low`, the
 *   default, starts it below Ork's own (under `nice`; on macOS also utility QoS
 *   through `taskpolicy`), so the user's own apps come first; `normal` leaves
 *   it. Only children: the `ork` process itself stays at normal priority.
 */

import { existsSync } from "node:fs";
import { constants, setPriority } from "node:os";
import path from "node:path";

import type { Priority } from "@krapht/ork-schema";

/** MacOS's tool for a program's QoS. */
const TASKPOLICY = "/usr/sbin/taskpolicy";

/** The POSIX tool that starts a program at a lower priority. */
const NICE = "/usr/bin/nice";

/** How far `nice` lowers a `low` child: the same as `PRIORITY_BELOW_NORMAL`. */
const NICE_STEP = String(constants.priority.PRIORITY_BELOW_NORMAL);

/**
 * Whether `bin` is a program `spawn` would find, so a wrapper can't hide its
 * absence.
 */
export const programFound = (
  bin: string,
  env: Readonly<Record<string, string | undefined>>,
) =>
  bin.includes("/")
    ? existsSync(bin)
    : (env["PATH"] ?? "")
        .split(path.delimiter)
        .some(dir => dir !== "" && existsSync(path.join(dir, bin)));

/**
 * What to spawn for `bin args` at `priority`. For `low`, when the program is
 * there: under `nice`, so it and what it starts run lower from the first
 * instruction, and on macOS under utility QoS as well; else the program itself,
 * which {@link lowerChild} lowers once it has started.
 */
export const startAt = (
  priority: Priority | undefined,
  bin: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): [string, string[]] => {
  if (priority !== "low" || !programFound(bin, env)) return [bin, [...args]];
  const niced = existsSync(NICE) ? [NICE, "-n", NICE_STEP, bin] : [bin];
  const [first = bin, ...rest] =
    process.platform === "darwin" && existsSync(TASKPOLICY)
      ? [TASKPOLICY, "-c", "utility", ...niced]
      : niced;
  return [first, [...rest, ...args]];
};

/**
 * Lowers a started child's priority for `low` where {@link startAt} had no
 * `nice` to start it under (Windows), best effort; what it starts later
 * inherits it. Under `nice` it does nothing: `nice` lowers relative to the
 * priority it finds, so lowering here too could land first and the two add up.
 */
export const lowerChild = (
  priority: Priority | undefined,
  pid: number | undefined,
): void => {
  if (priority !== "low" || pid === undefined || existsSync(NICE)) return;
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // The child still runs, at Ork's priority.
  }
};
