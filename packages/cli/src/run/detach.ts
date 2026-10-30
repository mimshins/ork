/**
 * @file `ork run --detach`: starts the same `ork run` as a background process
 *   with no terminal, its output in `.ork/runs/<run>/output.log`, and returns
 *   once the run is recorded. Its questions wait for `ork decide`.
 */

import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { type EventStore, projectRootOf } from "@krapht/ork-core";

/** Set in a detached run's environment: no terminal answers its questions. */
export const DETACHED_ENV = "ORK_DETACHED";

export type DetachOptions = {
  store: EventStore;
  runId: string;
  /** `ork run`'s arguments after `run`, `--detach` included. */
  rawArgs: readonly string[];
  cwd: string;
  /** How long to wait for the run to be recorded (default 15 s). */
  timeoutMs?: number;
};

export type Detached =
  | { ok: true; runId: string; log: string }
  | { ok: false; error: string; log: string };

export const detachRun = async (options: DetachOptions): Promise<Detached> => {
  const { runId } = options;
  const dir = path.join(projectRootOf(options.cwd), ".ork", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "output.log");
  const fd = openSync(log, "a");
  let exited: number | null = null;
  const script = process.argv[1] ?? "";
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      script,
      "run",
      ...options.rawArgs.filter(arg => arg !== "--detach"),
      "--run-id",
      runId,
    ],
    {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, [DETACHED_ENV]: "1", NO_COLOR: "1" },
    },
  );
  child.on("exit", code => {
    exited = code ?? 1;
  });
  child.unref();

  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    if (options.store.lookup(runId).length > 0) return { ok: true, runId, log };
    if (exited !== null) {
      return { ok: false, error: readFileSync(log, "utf8").trim(), log };
    }
    // oxlint-disable-next-line no-await-in-loop -- waiting for the child to record its run
    await sleep(100);
  }
  return { ok: false, error: "the run did not start in time", log };
};
