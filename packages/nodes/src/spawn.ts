/**
 * @file The real tool runner: `spawn` without a shell, output collected as
 *   text. A program runs in its own process group, so aborting it reaches
 *   whatever it started: SIGTERM, then SIGKILL for what ignores that. A stop or
 *   a timeout therefore leaves nothing running, and an escaped process that
 *   keeps the output pipes open cannot hold the node. Off Windows it runs under
 *   `sh`, whose `times` says the CPU the program and its children used, and at
 *   the project's priority: `low` starts it below Ork's own (nice, and on macOS
 *   utility QoS).
 */

import { spawn } from "node:child_process";
import { Readable } from "node:stream";

import { type CpuTime, lowerChild, startAt } from "@krapht/ork-core";
import type { Priority } from "@krapht/ork-schema";

import type { ToolRun, ToolRunner } from "./tool-command.ts";
import { withoutIdentity } from "./tool-env.ts";

/** How long a program may take to end after SIGTERM. */
export const KILL_AFTER_MS = 2000;

/** How long to wait for the pipes to close after SIGKILL. */
const CLOSE_AFTER_MS = 500;

/**
 * Runs `$0 "$@"`, then writes the shell's `times` to fd 3: its children's user
 * and system time, the program's whole tree that it waited for. A program that
 * isn't there says so on fd 3, as spawn's ENOENT would.
 */
const TIMED = String.raw`command -v "$0" >/dev/null 2>&1 || { echo ork-missing >&3; exit 127; }; "$0" "$@" 3>&-; s=$?; times >&3; exit $s`;

const MISSING = "ork-missing";

/** The children's line of `times` (`0m1.250s 0m0.300s`), in milliseconds. */
export const cpuOfTimes = (text: string): CpuTime | undefined => {
  const seconds = [...text.matchAll(/(\d+)m([\d.]+)s/gu)].map(
    ([, m = "0", s = "0"]) => Number(m) * 60 + Number(s),
  );
  const [, , user, system] = seconds;
  return user === undefined || system === undefined
    ? undefined
    : { userMs: Math.round(user * 1000), systemMs: Math.round(system * 1000) };
};

const timed = process.platform !== "win32";

/** What to start: the program, under `sh` to time it, at the priority. */
const startOf = (
  program: string,
  args: readonly string[],
  priority: Priority | undefined,
): [string, string[]] =>
  timed
    ? startAt(priority, "sh", ["-c", TIMED, program, ...args])
    : [program, [...args]];

export const spawnTool: ToolRunner = (
  program,
  args,
  { cwd, signal, env, priority },
) => {
  if (signal.aborted) {
    return Promise.resolve({
      exitCode: -1,
      stdout: "",
      stderr: `${program} was not started: the node was stopped`,
    });
  }
  return new Promise(resolve => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timers: NodeJS.Timeout[] = [];
    const times: string[] = [];
    const [bin, argv] = startOf(program, args, priority);
    const child = spawn(bin, argv, {
      cwd,
      detached: true,
      // An `ork` running in another run's node has that run's identity.
      env: { ...withoutIdentity(process.env), ...env },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    // Only without `nice` (Windows); `startAt` started it under `nice` otherwise.
    lowerChild(priority, child.pid);
    const fd3 = child.stdio[3];
    if (fd3 instanceof Readable) {
      fd3.setEncoding("utf8").on("data", (chunk: string) => {
        times.push(chunk);
      });
    }
    const killGroup = (kill: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, kill);
      } catch {
        // The group has already ended.
      }
    };
    const finish = (run: ToolRun): void => {
      for (const timer of timers) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(run);
    };
    const collected = (exitCode: number): ToolRun => {
      const said = times.join("");
      if (said.includes(MISSING)) {
        return {
          exitCode: -1,
          stdout: stdout.join(""),
          stderr: `could not run ${program}: spawn ${program} ENOENT`,
        };
      }
      const cpu = cpuOfTimes(said);
      return {
        exitCode,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        ...(cpu === undefined ? {} : { cpu }),
      };
    };
    const abort = (): void => {
      killGroup("SIGTERM");
      timers.push(
        setTimeout(() => {
          killGroup("SIGKILL");
          timers.push(
            setTimeout(() => {
              finish(collected(-1));
            }, CLOSE_AFTER_MS),
          );
        }, KILL_AFTER_MS),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr.push(chunk);
    });
    child.on("error", error => {
      finish({
        exitCode: -1,
        stdout: stdout.join(""),
        stderr: `could not run ${program}: ${error.message}`,
      });
    });
    child.on("close", code => {
      finish(collected(code ?? -1));
    });
  });
};
