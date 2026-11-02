/**
 * @file One `claude -p` process of a CLI-driven session: it writes the queued
 *   stream-json lines, yields the normalized events, and says how it ended. A
 *   session is one leg, or several when a paused node's tool call was deferred
 *   and the session resumed (ADR-041); a resumed leg carries what the legs
 *   before it spent, and its start is not news.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { RuntimeEvent, SessionUsage } from "@krapht/ork-core";

import { type Leg, legStep } from "./hold.ts";

const STDERR_LINES = 20;

export type LegInput = {
  bin: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  args: string[];
  /** What the legs before this one spent; none for the first. */
  carried: SessionUsage | undefined;
  /** Lines to write once the process is up; emptied as they are written. */
  pending: string[];
  /** Whether the hold hook deferred a call in this process. */
  deferred: () => boolean;
  /** The process's stdin and stop while it runs; nothing after. */
  attach: (io?: { write: (line: string) => void; stop: () => void }) => void;
};

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** Runs one `claude` process, yielding its events; returns how it ended. */
export const runLeg = async function* (
  input: LegInput,
): AsyncGenerator<RuntimeEvent, Leg> {
  const child = spawn(input.bin, input.args, {
    cwd: input.cwd,
    env: { ...input.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>(resolve => {
    child.on("close", code => {
      resolve(code);
    });
  });
  const spawnError = new Promise<Error>(resolve => {
    child.on("error", resolve);
  });
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr.push(...chunk.split("\n").filter(l => l.trim() !== ""));
    stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
  });
  const write = (line: string) => {
    if (child.stdin.writable) child.stdin.write(line);
  };
  input.attach({
    write,
    stop: () => {
      child.kill("SIGINT");
    },
  });
  for (const line of input.pending.splice(0)) write(line);

  let outcome: Leg | undefined;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const { events, ended } = legStep(parseLine(line), {
        carried: input.carried,
        deferred: input.deferred(),
        driver: "cli",
      });
      yield* events;
      if (ended !== undefined) {
        // The first result ends the process; `--resume` continues the session.
        child.stdin.end();
        outcome = ended;
      }
    }
    const code = await Promise.race([exited, spawnError.then(error => error)]);
    return (
      outcome ?? {
        kind: "failed",
        reason:
          code instanceof Error
            ? `could not start ${input.bin}: ${code.message}`
            : (stderr.at(-1) ?? `claude exited with code ${String(code)}`),
      }
    );
  } finally {
    input.attach();
    if (child.exitCode === null) child.kill();
  }
};
