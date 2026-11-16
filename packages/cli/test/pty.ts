/**
 * @file Runs `ork` on a real terminal for tests: `script(1)` gives it a pty, so
 *   a `\x03` written to its input is a Ctrl-C the terminal turns into SIGINT,
 *   as a person's would be. macOS and Linux call `script` differently; the
 *   command is `exec`ed so no shell between them takes the signal or the exit
 *   code. Its input is a pipe fed from a FIFO and its output a file, as macOS's
 *   `script` refuses a FIFO and the sockets Node's piped stdio are. Needs
 *   `bash`; not on Windows.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  type WriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, vi } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** Whether this platform can run `ork` on a pty through `script`. */
export const hasPty =
  process.platform === "darwin" || process.platform === "linux";

const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** `script`'s arguments to run `command` on a pty and return its exit code. */
const scriptArgs = (command: readonly string[]): string[] =>
  process.platform === "darwin"
    ? ["-q", "/dev/null", ...command]
    : [
        "-qec",
        `exec ${command.map(word => quoted(word)).join(" ")}`,
        "/dev/null",
      ];

const CTRL_C = "\u0003";

export type PtyOrk = {
  child: ChildProcess;
  /** What the person types, through the terminal. */
  keys: WriteStream;
  /** Everything it printed so far. */
  output: () => string;
  /** Its exit code once it ends. */
  exited: Promise<number | null>;
};

/**
 * `command` (a program and its words) on a pty, with `env` as its whole
 * environment.
 */
const onPty = (command: readonly string[], env: NodeJS.ProcessEnv): PtyOrk => {
  const folder = mkdtempSync(path.join(tmpdir(), "ork-pty-"));
  const fifo = path.join(folder, "keys");
  const screen = path.join(folder, "screen");
  spawnSync("mkfifo", [fifo]);
  const script = ["script", ...scriptArgs(command)];
  // `cat` turns the FIFO into a pipe: macOS's `script` refuses a FIFO too.
  const child = spawn(
    "bash",
    [
      "-c",
      `exec ${script.map(word => quoted(word)).join(" ")} < <(cat ${quoted(fifo)}) > ${quoted(screen)} 2>&1`,
    ],
    { env, stdio: "ignore" },
  );
  const keys = createWriteStream(fifo);
  const exited = new Promise<number | null>(resolve => {
    child.on("close", code => {
      resolve(code);
    });
  });
  const output = (): string =>
    existsSync(screen) ? readFileSync(screen, "utf8") : "";
  return { child, keys, output, exited };
};

/** `ork <args>` on a pty, with `env` as its whole environment. */
export const orkOnPty = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): PtyOrk => onPty([process.execPath, BIN, ...args], env);

/**
 * A TypeScript file Node runs (a test fixture) on a pty, as `orkOnPty` runs
 * `ork`.
 */
export const scriptOnPty = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): PtyOrk => onPty([process.execPath, file, ...args], env);

/**
 * Presses Ctrl-C, then, once the terminal shows it (`^C`), closes the input:
 * Linux's `script` waits for its input to end before it exits, even after the
 * command has.
 */
export const pressCtrlC = async (pty: PtyOrk): Promise<void> => {
  pty.keys.write(CTRL_C);
  await vi.waitFor(() => {
    expect(pty.output()).toContain("^C");
  });
  pty.keys.end();
};
