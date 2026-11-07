/**
 * @file Runs an installer's command (ADR-038), with no shell: on the terminal
 *   for `ork upgrade`, or with its output handed over piece by piece for the
 *   server behind `ork ui`, which shows it in the browser. Handed over, the
 *   package manager gets no standard input, so it can never wait on a question
 *   no one can answer. A program that can't start ends with 127, as a shell
 *   would.
 */

import { spawn } from "node:child_process";

export type InstallStream = "stdout" | "stderr";

/** What `runInstall` hands the output to, a piece at a time. */
export type InstallOutput = (stream: InstallStream, text: string) => void;

/** The exit code a shell gives a program it could not start. */
export const INSTALL_NOT_STARTED = 127;

/**
 * Runs the command; resolves its exit code. Without `onOutput` it writes on the
 * terminal.
 */
export const runInstall = (
  argv: readonly string[],
  onOutput?: InstallOutput,
): Promise<number> =>
  new Promise(resolve => {
    const [program = "", ...args] = argv;
    const child = spawn(program, args, {
      stdio: onOutput === undefined ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.setEncoding("utf8");
      child[stream]?.on("data", (text: string) => {
        onOutput?.(stream, text);
      });
    }
    child.on("error", error => {
      const line = `Could not run ${program}: ${error.message}\n`;
      if (onOutput === undefined) process.stderr.write(line);
      else onOutput("stderr", line);
      resolve(INSTALL_NOT_STARTED);
    });
    child.on("close", code => {
      resolve(code ?? 1);
    });
  });
