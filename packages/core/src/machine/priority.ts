/**
 * @file Starting a child at the project's priority (`priority:`): `low`, the
 *   default, lowers it below Ork's own (nice; on macOS also utility QoS through
 *   `taskpolicy`), so the user's own apps come first; `normal` leaves it. Only
 *   children: the `ork` process itself stays at normal priority.
 */

import { existsSync } from "node:fs";
import { constants, setPriority } from "node:os";
import path from "node:path";

import type { Priority } from "@krapht/ork-schema";

/** MacOS's tool for a program's QoS. */
const TASKPOLICY = "/usr/sbin/taskpolicy";

/**
 * Whether `bin` is a program `spawn` would find, so a wrapper can't hide its
 * absence.
 */
const found = (
  bin: string,
  env: Readonly<Record<string, string | undefined>>,
) =>
  bin.includes("/")
    ? existsSync(bin)
    : (env["PATH"] ?? "")
        .split(path.delimiter)
        .some(dir => dir !== "" && existsSync(path.join(dir, bin)));

/**
 * What to spawn for `bin args` at `priority`: under utility QoS on macOS for
 * `low`, when `taskpolicy` and the program are there; else the program itself.
 */
export const startAt = (
  priority: Priority | undefined,
  bin: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): [string, string[]] =>
  priority === "low" &&
  process.platform === "darwin" &&
  existsSync(TASKPOLICY) &&
  found(bin, env)
    ? [TASKPOLICY, ["-c", "utility", bin, ...args]]
    : [bin, [...args]];

/**
 * Lowers a started child's priority for `low`, best effort; what it starts
 * later inherits it.
 */
export const lowerChild = (
  priority: Priority | undefined,
  pid: number | undefined,
): void => {
  if (priority !== "low" || pid === undefined) return;
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // The child still runs, at Ork's priority.
  }
};
