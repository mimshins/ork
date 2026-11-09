/**
 * @file One `claude -p` process of a CLI-driven session: it writes the queued
 *   stream-json lines, yields the normalized events, and says how it ended. A
 *   session is one leg, or several when a paused node's tool call was deferred
 *   and the session resumed (ADR-041); a resumed leg carries what the legs
 *   before it spent, and its start is not news.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  maskSecrets,
  type RuntimeEvent,
  type SessionUsage,
} from "@krapht/ork-core";

import { type Leg, legStep } from "./hold.ts";

/** How much of the end of a process's stderr is kept to explain its death. */
const STDERR_TAIL = 16_384;
const REASON_LIMIT = 500;

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

/** Noise a Node crash ends stderr with, or a stack frame: never the reason. */
const isNoise = (line: string): boolean =>
  /^Node\.js v\d/u.test(line) || /^\s+at /u.test(line);

/**
 * Why a process ended without a result: the last block of its stderr as one
 * masked, capped line (the reason reaches the terminal, which is not masked).
 */
const failureReason = (stderr: string, code: number | null): string => {
  const block = stderr
    .split("\n")
    .filter(line => !isNoise(line))
    .join("\n")
    .split(/\n\s*\n/u)
    .map(text => text.trim().replaceAll(/\s*\n\s*/gu, " "))
    .findLast(text => text !== "");
  return block === undefined
    ? `claude exited with code ${String(code)}`
    : maskSecrets(block).slice(0, REASON_LIMIT);
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
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>(resolve => {
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const spawnError = new Promise<Error>(resolve => {
    child.on("error", resolve);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  const write = (line: string) => {
    if (child.stdin.writable) child.stdin.write(line);
  };
  let stopped = false;
  input.attach({
    write,
    stop: () => {
      stopped = true;
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
    const end = await Promise.race([exited, spawnError.then(error => error)]);
    if (outcome !== undefined) return outcome;
    if (end instanceof Error) {
      return {
        kind: "failed",
        reason: `could not start ${input.bin}: ${end.message}`,
      };
    }
    return {
      kind: "failed",
      reason:
        stopped || end.signal !== null
          ? "interrupted"
          : failureReason(stderr, end.code),
    };
  } finally {
    input.attach();
    if (child.exitCode === null) child.kill();
  }
};
