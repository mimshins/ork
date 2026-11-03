/**
 * @file The real tool runner: `spawn` without a shell, output collected as
 *   text. A program runs in its own process group, so aborting it reaches
 *   whatever it started: SIGTERM, then SIGKILL for what ignores that. A stop or
 *   a timeout therefore leaves nothing running, and an escaped process that
 *   keeps the output pipes open cannot hold the node.
 */

import { spawn } from "node:child_process";

import { withoutIdentity } from "./tool-env.ts";
import type { ToolRun, ToolRunner } from "./tools.ts";

/** How long a program may take to end after SIGTERM. */
export const KILL_AFTER_MS = 2000;

/** How long to wait for the pipes to close after SIGKILL. */
const CLOSE_AFTER_MS = 500;

export const spawnTool: ToolRunner = (program, args, { cwd, signal, env }) => {
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
    const child = spawn(program, args, {
      cwd,
      detached: true,
      // An `ork` running in another run's node has that run's identity.
      env: { ...withoutIdentity(process.env), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
    const collected = (exitCode: number): ToolRun => ({
      exitCode,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    });
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
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
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
