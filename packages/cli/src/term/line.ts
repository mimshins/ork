/**
 * @file The plain way to ask: one prompt, one line read. It is what every kit
 *   prompt falls back to (not a terminal, `NO_COLOR`, `--plain`), so scripts
 *   and tests that feed lines keep working, and what a screen reader sees.
 */

import { createInterface } from "node:readline/promises";

import { plainEnv, type PromptIO } from "./mode.ts";

/**
 * Prints `prompt` and reads one line; `undefined` when the input ends first
 * (Ctrl-D, a closed pipe). An aborted `signal` rejects.
 */
export const readLine = async (
  io: PromptIO,
  prompt: string,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  if (io.readLine !== undefined) return io.readLine(prompt, signal);
  // Asked for plain, readline must not redraw the line with escape codes.
  const rl = createInterface({
    input: io.input,
    output: io.output,
    ...(plainEnv(io.env) ? { terminal: false } : {}),
  });
  const { promise: ended, resolve: end } = Promise.withResolvers<void>();
  rl.once("close", () => {
    end();
  });
  try {
    const answer = await Promise.race([
      signal === undefined
        ? rl.question(prompt)
        : rl.question(prompt, { signal }),
      ended,
    ]);
    return typeof answer === "string" ? answer : undefined;
  } finally {
    rl.close();
  }
};

/** Ends a rich prompt on Ctrl-C: the caller's hook, else `SIGINT`. */
export const interrupt = (io: PromptIO): void => {
  if (io.interrupt === undefined) process.kill(process.pid, "SIGINT");
  else io.interrupt();
};

/** The error a withdrawn prompt rejects with: the signal's own, if it is one. */
export const withdrawn = (signal: AbortSignal | undefined): Error =>
  signal?.reason instanceof Error
    ? signal.reason
    : new Error("the prompt was withdrawn");
