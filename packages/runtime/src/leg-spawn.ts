/**
 * @file Starting one process (leg) of a session: at the project's priority, and
 *   off Windows in its own process group beside the orphan guard, so it and
 *   what it started end with `ork`, whatever ends `ork`. The process's pid, and
 *   the SIGINT that stops it, stay the driver's own.
 */

import {
  type ChildProcess,
  type ChildProcessByStdio,
  spawn,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

import {
  holdGuard,
  orphanGuard,
  programFound,
  startAt,
} from "@krapht/ork-core";
import type { Priority } from "@krapht/ork-schema";

/** The fd of the orphan guard's pipe from `ork`. */
const WATCH_FD = 3;

/**
 * Starts the orphan guard, then becomes the driver. The pipe is closed by a
 * bare `exec`: macOS's `sh` keeps a copy of a descriptor an `exec` command
 * closes, which the driver and its leftovers would then inherit.
 */
const GUARDED = `${orphanGuard(WATCH_FD)}exec ${String(WATCH_FD)}<&-; exec "$0" "$@"`;

/** What a leg is started with. */
export type LegStart = {
  bin: string;
  args: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  priority?: Priority;
  cwd: string;
};

type Piped = ChildProcessByStdio<Writable, Readable, Readable>;

const piped = (child: ChildProcess): child is Piped =>
  child.stdin !== null && child.stdout !== null && child.stderr !== null;

/**
 * Spawns the leg's process. A program that isn't there is spawned bare, so it
 * fails as spawn's ENOENT; the guard is released once the driver exits, so a
 * session that ends normally leaves its leftovers alone.
 */
export const spawnLeg = (start: LegStart): Piped => {
  const [bin, args] = startAt(start.priority, start.bin, start.args, start.env);
  const guarded =
    process.platform !== "win32" && programFound(start.bin, start.env);
  const child = spawn(
    guarded ? "/bin/sh" : bin,
    guarded ? ["-c", GUARDED, bin, ...args] : args,
    {
      cwd: start.cwd,
      detached: guarded,
      env: { ...start.env },
      stdio: ["pipe", "pipe", "pipe", guarded ? "pipe" : "ignore"],
    },
  );
  if (!piped(child)) throw new Error(`${start.bin} was started without pipes`);
  if (guarded) {
    const release = holdGuard(child.stdio[WATCH_FD]);
    // On exit, not close: the guard's pipe holds `close` until it is released.
    child.once("exit", release);
  }
  return child;
};
