/**
 * @file The orphan guard: a node's processes end with `ork`, whatever ends
 *   `ork` (SIGKILL, the OOM killer, a crash exit). A child started in its own
 *   process group (`detached: true`) under `sh` also starts a small watcher in
 *   that group, which reads a pipe that only `ork` holds open. `ork` never
 *   writes to it, so when `ork` dies the read sees EOF, and the watcher sends
 *   its own group (`kill 0`, never another's) SIGTERM, then SIGKILL after
 *   {@link KILL_AFTER_MS}. A line on the pipe instead lets the watcher exit
 *   quietly, and so does killing it, which is how a node that ends normally
 *   leaves its leftover background processes alone. POSIX only. Two uses:
 *
 *   - A shell that outlives the program (the tool runner's timing wrapper):
 *     `${orphanGuard(4)} w=$!; "$0" "$@" 4<&-; s=$?; kill -s KILL $w`, then
 *     spawn with a `"pipe"` at `stdio[4]` and call
 *     `holdGuard(child.stdio[4])`.
 *   - A shell that `exec`s the program (a session, so its pid stays the
 *     driver's): `${orphanGuard(3)} exec 3<&-; exec "$0" "$@"` (a bare `exec`
 *     closes the pipe: macOS's `sh` keeps a copy of one an `exec` command
 *     closes, which the driver would inherit), with a `"pipe"` at `stdio[3]`;
 *     nothing is left to kill the watcher, so call the function `holdGuard`
 *     returns once the driver has exited (on `exit`: the pipe holds `close`).
 */

import { Readable, Writable } from "node:stream";

/** How long the group gets to end after SIGTERM before SIGKILL. */
export const KILL_AFTER_MS = 2000;

/** The file descriptors a redirect can name in every POSIX shell. */
const SHELL_FDS = [3, 4, 5, 6, 7, 8, 9];

/**
 * Shell text that starts the watcher in the background on pipe `fd` (3 to 9);
 * it ends with `&`, so `$!` after it is the watcher's pid. The watcher holds no
 * other descriptor, so it never keeps the child's output pipes open.
 */
export const orphanGuard = (fd: number): string => {
  const others = SHELL_FDS.filter(other => other !== fd)
    .map(other => `${String(other)}>&-`)
    .join(" ");
  const seconds = String(KILL_AFTER_MS / 1000);
  return `{ read -r _ork <&${String(fd)} || { trap '' TERM; kill -s TERM 0; sleep ${seconds}; kill -s KILL 0; }; } </dev/null >/dev/null 2>&1 ${others} & `;
};

/**
 * Keeps `ork`'s end of the watch pipe (`child.stdio[fd]`) open and drained, so
 * it never holds back the child's `close`; returns the release, which writes
 * the line that lets the watcher exit without touching its group.
 */
export const holdGuard = (
  pipe: Readable | Writable | null | undefined,
): (() => void) => {
  // A write after the child has gone fails with EPIPE: nothing is left to guard.
  pipe?.on("error", () => {
    // Ignored.
  });
  if (pipe instanceof Readable) pipe.resume();
  return () => {
    if (pipe instanceof Writable && pipe.writable) pipe.write("\n");
  };
};
