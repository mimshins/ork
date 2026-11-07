/**
 * @file The one upgrade a server runs at a time (specs/cli/updates.md): it runs
 *   the installer's command through core's `runInstall`, keeps its output as
 *   numbered lines (the last 2,000, ANSI codes taken out, a line a progress bar
 *   redrew kept as it ended), tells whoever listens of each line and of the
 *   end, and stays for the server's life, so a reload or a second tab finds
 *   it.
 */

import { randomUUID } from "node:crypto";

import type { InstallOutput, InstallStream } from "@krapht/ork-core";

import type {
  UpgradeEnd,
  UpgradeJob,
  UpgradeOutput,
} from "./contract-update.ts";

/** How many lines of output a job keeps. */
export const KEPT_LINES = 2000;

/** Runs an installer's command, handing its output over; resolves its code. */
export type Install = (
  argv: readonly string[],
  onOutput: InstallOutput,
) => Promise<number>;

export type JobEvent =
  | { kind: "output"; line: UpgradeOutput }
  | { kind: "end"; end: UpgradeEnd };

export type JobListener = (event: JobEvent) => void;

// Escape sequences: CSI (colors, cursor moves) and OSC (titles, links).
const ANSI =
  // oxlint-disable-next-line no-control-regex -- matching terminal escapes is the point
  /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-Z\\-_]/gu;

/** A line as a terminal would end up showing it. */
export const plainLine = (raw: string): string =>
  (
    raw
      .replaceAll(ANSI, "")
      .split("\r")
      .findLast(part => part !== "") ?? ""
  ).replaceAll(/\s+$/gu, "");

export type RunningJob = {
  view: () => UpgradeJob;
  /** The kept lines after `after`, and whether earlier ones were dropped. */
  linesAfter: (after: number) => {
    lines: UpgradeOutput[];
    dropped: boolean;
  };
  end: () => UpgradeEnd | null;
  /** Settles once the installer has exited and its end is told. */
  done: Promise<void>;
  /** Listens until the returned function is called. */
  listen: (listener: JobListener) => () => void;
};

export const startJob = (
  latest: string,
  argv: readonly string[],
  install: Install,
  onChange: () => void,
): RunningJob => {
  const job: UpgradeJob = {
    id: randomUUID(),
    state: "running",
    latest,
    command: [...argv],
    startedAt: new Date().toISOString(),
  };
  const lines: UpgradeOutput[] = [];
  const partial: Record<InstallStream, string> = { stdout: "", stderr: "" };
  const listeners = new Set<JobListener>();
  let seq = 0;
  let ended: UpgradeEnd | null = null;

  const tell = (event: JobEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const keep = (stream: InstallStream, raw: string): void => {
    seq += 1;
    const line: UpgradeOutput = { seq, stream, text: plainLine(raw) };
    lines.push(line);
    if (lines.length > KEPT_LINES) lines.shift();
    tell({ kind: "output", line });
  };

  const output: InstallOutput = (stream, text) => {
    const parts = `${partial[stream]}${text}`.split("\n");
    partial[stream] = parts.pop() ?? "";
    for (const part of parts) keep(stream, part);
  };

  const finished = install(argv, output).catch((error: unknown) => {
    keep("stderr", error instanceof Error ? error.message : String(error));
    return 1;
  });
  const finish = async (): Promise<void> => {
    const code = await finished;
    for (const stream of ["stdout", "stderr"] as const) {
      if (partial[stream] !== "") keep(stream, partial[stream]);
      partial[stream] = "";
    }
    const state = code === 0 ? "succeeded" : "failed";
    Object.assign(job, { state, code, endedAt: new Date().toISOString() });
    ended = { state, code, version: latest };
    onChange();
    tell({ kind: "end", end: ended });
  };
  const done = finish();

  return {
    view: () => ({ ...job, command: [...job.command] }),
    linesAfter: after => ({
      lines: lines.filter(line => line.seq > after),
      dropped: (lines[0]?.seq ?? 1) > after + 1,
    }),
    end: () => ended,
    done,
    listen: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
